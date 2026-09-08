import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, statSync, openSync, closeSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { encode, decode, frames, FrameReader } from "./remote-codec.mjs";

export function remoteConfigPath() {
  return join(process.env.CODEX_HOME || join(homedir(), ".codex"), "zcode-ops", "remote.json");
}
export function readRemoteUrl() {
  let file = process.env.ZCODE_REMOTE_URL_FILE;
  if (!file) {
    try { file = JSON.parse(readFileSync(remoteConfigPath(), "utf8")).urlFile; }
    catch { throw Error("Configure ZCODE_REMOTE_URL_FILE or zcode-ops/remote.json in Codex home"); }
  }
  if (typeof file !== "string" || !isAbsolute(file)) throw Error("Remote URL file must be an absolute path");
  let content;
  try {
    if (statSync(file).size > 16384) throw Error();
    content = readFileSync(file, "utf8");
  } catch { throw Error("Cannot read bounded remote URL file"); }
  const matches = content.match(/https:\/\/[^\s<>"\u0000]+/g);
  if (matches?.length !== 1) throw Error("Remote URL file must contain exactly one HTTPS URL");
  return validateRemoteUrl(matches[0]);
}
export function validateRemoteUrl(value) {
  let u; try { u = new URL(value); } catch { throw Error("Invalid remote URL"); }
  if (u.origin !== "https://zcode.z.ai" || u.pathname !== "/remote/v4" || u.username || u.password ||
      !["sid", "hash", "mid"].every(k => u.searchParams.getAll(k).length === 1 && u.searchParams.get(k))) throw Error("Expected an official ZCode /remote/v4 authorization link");
  return u;
}

export class RemoteClient {
  constructor(url, { WebSocketClass = WebSocket, timeoutMs = 15000 } = {}) {
    this.url = validateRemoteUrl(url.toString()); this.WebSocketClass = WebSocketClass; this.timeoutMs = timeoutMs;
    this.waiters = new Set(); this.reader = new FrameReader(); this.serial = 0; this.seq = 0; this.messageSeq = 0;
  }
  sanitized(error) {
    let text = String(error?.message || "Remote operation failed").replace(/https?:\/\/\S+/g, "[redacted-url]");
    for (const value of this.url.searchParams.values()) if (value) text = text.split(value).join("[redacted]");
    return Error(text.slice(0, 500));
  }
  wait(match, send = () => {}) {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      const done = (error, value) => { clearTimeout(timer); this.waiters.delete(w); error ? reject(error) : resolve(value); };
      const w = { match, done };
      const timer = setTimeout(() => done(Error("ZCode remote request timed out")), this.timeoutMs);
      this.waiters.add(w);
      try { send(); } catch (e) { done(this.sanitized(e)); }
    });
  }
  deliver(message) { for (const w of [...this.waiters]) if (w.match(message)) w.done(null, message); }
  fail(error) { this.failed = this.sanitized(error); for (const w of [...this.waiters]) w.done(this.failed); }
  raw(message) { this.ws.send(JSON.stringify(message)); }
  payload(payload) { this.raw({ type: "data", payload, client_ts: Date.now() }); }
  async connect() {
    const u = new URL("wss://zcode.z.ai/ws"); u.searchParams.set("mid", this.url.searchParams.get("mid"));
    await this.wait(m => m.kind === "paired", () => {
      this.ws = new this.WebSocketClass(u.href);
      this.ws.addEventListener("error", () => this.fail(Error("ZCode remote transport error")));
      this.ws.addEventListener("close", () => this.fail(Error("ZCode remote connection closed")));
      this.ws.addEventListener("message", event => { void this.receive(event.data).catch(e => this.fail(e)); });
      this.ws.addEventListener("open", () => {
        try { this.raw({ type: "auth_init", role: "terminal", device_sid: this.url.searchParams.get("sid"), meta: { platform: "web", version: this.url.searchParams.get("app_version") || "web-remote", name: "mobile-browser" }, client_ts: Date.now() }); }
        catch (e) { this.fail(e); }
      });
    });
  }
  async receive(raw) {
    const text = typeof raw === "string" ? raw : await raw.text();
    if (text.length > 1024 * 1024) throw Error("Remote physical frame exceeds limit");
    const m = JSON.parse(text);
    if (m.type === "auth_challenge") {
      if (typeof m.nonce !== "string" || m.nonce.length > 4096) throw Error("Invalid relay challenge");
      const sid = this.url.searchParams.get("sid");
      this.raw({ type: "auth_response", device_sid: sid, proof: createHmac("sha256", this.url.searchParams.get("hash")).update(`${m.nonce}|terminal|${sid}`).digest("base64url"), client_ts: Date.now() });
    } else if (m.type === "auth_ack" || m.type === "pair_status_ack") {
      if (m.pair_status === "matched") this.deliver({ kind: "paired" });
    } else if (m.type === "error") throw Error(m.message || m.code || "Relay rejected request");
    else if (m.type === "data") {
      const p = m.payload;
      if (p?.zcode_type !== "rpc-frame") { this.deliver(p); return; }
      if (p.bridgeSessionId !== this.bridge?.bridgeSessionId ||
          p.bridgeGeneration !== this.bridge?.bridgeGeneration) return;
      const bytes = this.reader.accept(p); if (!bytes) return;
      this.payload({ zcode_type: "rpc-frame-ack", bridgeSessionId: p.bridgeSessionId, ackMessageSeq: p.messageSeq });
      const [header, body] = decode(bytes);
      if (!Array.isArray(header)) throw Error("Invalid remote RPC header");
      this.deliver({ kind: "rpc", header, body });
    }
  }
  async list() {
    const requestId = randomUUID();
    const response = await this.wait(p => p?.zcode_type === "workspace-list-response" && p.requestId === requestId,
      () => this.payload({ zcode_type: "workspace-list-request", requestId }));
    if (!Array.isArray(response.result?.tasks) || !Array.isArray(response.result?.workspaces)) throw Error("Unsupported ZCode task-list schema");
    return response.result;
  }
  async open(task) {
    if (task.workspaceKind !== "local") throw Error("This version supports existing local desktop tasks only");
    const bridgeSessionId = randomUUID();
    this.bridge = { bridgeSessionId, bridgeGeneration: 1 };
    const response = await this.wait(p => p?.bridgeSessionId === bridgeSessionId && ["workspace-bridge-ready", "workspace-bridge-error"].includes(p.zcode_type),
      () => this.payload({ zcode_type: "workspace-bridge-open", requestId: randomUUID(), ...this.bridge, workspaceKey: task.workspacePath, taskId: task.taskId }));
    if (response.zcode_type === "workspace-bridge-error") throw Error("Desktop rejected the workspace bridge");
    if (response.bridge?.initialTaskId !== task.taskId) throw Error("Desktop returned a different task");
    this.bridge = response.bridge;
  }
  async rpc(method, args) {
    if (!this.bridge) throw Error("No desktop task attached");
    if (!["getTaskSnapshot", "sendPrompt"].includes(method)) throw Error("Remote method not allowed");
    const id = ++this.serial;
    const response = await this.wait(m => m?.kind === "rpc" && m.header[1] === id && m.header[0] !== 200, () => {
      const bytes = Buffer.concat([encode([100, id, "zcode-task", method]), encode([args])]);
      for (const frame of frames(bytes, this.bridge, ++this.messageSeq)) this.payload({ ...frame, seq: ++this.seq });
    });
    if (response.header[0] !== 201) throw this.sanitized(Error(typeof response.body === "string" ? response.body : response.body?.message || "Desktop RPC rejected request"));
    return response.body;
  }
  snapshot(taskId, limit = 100) {
    return this.rpc("getTaskSnapshot", { taskId, workspacePath: this.bridge.workspacePath, clientMode: "web-remote-replayable", messageLimit: limit, byteBudget: 1024 * 1024, toolLimit: 0 });
  }
  send(taskId, content) {
    const ids = { traceId: randomUUID(), queryId: randomUUID(), messageId: randomUUID() };
    return this.rpc("sendPrompt", { taskId, content, ...ids, attachments: [], clientMode: "web-remote-replayable", clientId: "zcode-ops", clientLabel: "Codex ZCode Ops" })
      .then(result => ({ request: ids, result }));
  }
  async close() {
    this.fail(Error("Remote operation ended"));
    if (!this.ws || this.ws.readyState === 3) return;
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 1000);
      this.ws.addEventListener("close", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.close();
    });
  }
}

let queue = Promise.resolve();
export function withRemote(action) {
  const run = queue.then(async () => {
    const url = readRemoteUrl();
    const lock = join(dirname(remoteConfigPath()), "remote.lock");
    mkdirSync(dirname(lock), { recursive: true });
    let fd;
    try { fd = openSync(lock, "wx", 0o600); }
    catch { throw Error("ZCode remote connection is busy; if no client is running, remove zcode-ops/remote.lock in Codex home"); }
    const client = new RemoteClient(url);
    try { writeFileSync(fd, String(process.pid)); await client.connect(); return await action(client); }
    catch (e) { throw client.sanitized(e); }
    finally { await client.close(); closeSync(fd); unlinkSync(lock); }
  });
  queue = run.catch(() => {});
  return run;
}
