import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encode, decode, frames, FrameReader, checksum } from "./remote-codec.mjs";
import { RemoteClient, validateRemoteUrl } from "./remote-client.mjs";
import { normalizeTask, callRemoteTool } from "./remote-tools.mjs";
import { callConfigTool, readConfig, validateConfig, writeConfig } from "./config.mjs";

const bridge = { bridgeSessionId: "test", bridgeGeneration: 1, initialTaskId: "sess_test", workspacePath: "test-workspace" };
assert.equal(checksum(Buffer.from("123456789")), "cbf43926");
const value = [100, 1, "中文", { ok: true, nested: [null, false] }, undefined, Buffer.from([0, 255])];
assert.deepEqual(decode(encode(value)), [value]);
assert.throws(() => decode(Buffer.from([4, 255, 255, 255, 255, 127])));
assert.throws(() => decode(Buffer.from([1, 100, 0])));
const payload = encode("汉字".repeat(100000)), parts = frames(payload, bridge, 1), reader = new FrameReader();
assert(parts.length > 1);
assert.equal(reader.accept(parts[1]), null);
assert.equal(reader.accept(parts[1]), null);
assert.deepEqual(reader.accept(parts[0]), payload);
assert.throws(() => new FrameReader().accept({ ...frames(encode("x"), bridge, 2)[0], checksum: { algorithm: "crc32", value: "00000000" } }));
assert.throws(() => validateRemoteUrl("https://example.com/remote/v4?sid=x&hash=x&mid=x"));
assert.throws(() => validateRemoteUrl("https://zcode.z.ai/remote/v4?sid=x&sid=y&hash=x&mid=x"));
assert.equal(normalizeTask({ displayStatus: "error" }).status, "failed");
assert.equal(normalizeTask({ displayStatus: "__proto__" }).status, "unknown");
assert.equal(normalizeTask({ updatedAt: 1 }).status, "unknown", "Stale time must never infer interruption");

const configDir = mkdtempSync(join(tmpdir(), "zcode-ops-"));
const previousConfig = process.env.ZCODE_OPS_CONFIG;
process.env.ZCODE_OPS_CONFIG = join(configDir, "config.json");
try {
  assert.throws(() => validateConfig({ schemaVersion: 1, promptOnStartup: true, sharingLink: null, extra: true }));
  writeConfig({ sharingLink: null });
  assert.equal(readConfig().sharingLink, null);
  const invalidPath = join(configDir, "invalid.json");
  process.env.ZCODE_OPS_CONFIG = invalidPath; writeFileSync(invalidPath, "not json");
  assert.equal((await callConfigTool("zcode_config_status")).valid, false);
  process.env.ZCODE_OPS_CONFIG = join(configDir, "config.json");
  const set = await callConfigTool("zcode_config_set", { sharingLink: "not-prevalidated-secret" });
  assert.equal(set.configured, true); assert(!JSON.stringify(set).includes("secret"));
  const status = await callConfigTool("zcode_config_status"); assert.equal(status.valid, true); assert(!JSON.stringify(status).includes("secret"));
  await callConfigTool("zcode_config_clear"); assert.equal(readConfig().sharingLink, null);
} finally {
  if (previousConfig === undefined) delete process.env.ZCODE_OPS_CONFIG; else process.env.ZCODE_OPS_CONFIG = previousConfig;
  rmSync(configDir, { recursive: true, force: true });
}

const calls = [];
let currentModel = "builtin:bigmodel-coding-plan/GLM-5.3-Flash";
const modelOptions = [
  { value: "builtin:bigmodel-coding-plan/GLM-5.3-Flash", name: "GLM-5.3-Flash" },
  { value: "custom/deepseek-v4-flash-vision-exp", name: "deepseek-v4-flash-vision-exp" }
];
const configOptions = () => [{ id: "model", category: "model", currentValue: currentModel, options: modelOptions },
  { id: "thoughtLevel", category: "thought_level", currentValue: "max", options: [] }];
const snapshot = () => ({ messages: [{ id: "answer", role: "assistant", content: "你好" }], runtime: {}, history: { totalMessages: 1 },
  meta: { model: currentModel, thoughtLevel: "max" }, configOptions: configOptions() });
class FakeSocket extends EventTarget {
  readyState = 0;
  constructor() { super(); queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new Event("open")); }); }
  message(value) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
  send(raw) {
    const m = JSON.parse(raw);
    queueMicrotask(() => {
      if (m.type === "auth_init") this.message({ type: "auth_challenge", nonce: "test-nonce" });
      else if (m.type === "auth_response") this.message({ type: "auth_ack", pair_status: "matched" });
      else if (m.payload?.zcode_type === "workspace-list-request") this.message({ type: "data", payload: { zcode_type: "workspace-list-response", requestId: m.payload.requestId, result: { workspaces: [], tasks: [{ taskId: "sess_test" }] } } });
      else if (m.payload?.zcode_type === "workspace-bridge-open") {
        Object.assign(bridge, { bridgeSessionId: m.payload.bridgeSessionId });
        this.message({ type: "data", payload: { zcode_type: "workspace-bridge-ready", bridgeSessionId: bridge.bridgeSessionId, bridge } });
      } else if (m.payload?.zcode_type === "rpc-frame") {
        const [header, args] = decode(new FrameReader().accept(m.payload));
        calls.push({ header, args });
        if (header[3] === "setConfigOption") currentModel = args[0].value;
        const body = header[3] === "getTaskSnapshot" ? snapshot() : header[3] === "getTaskConfigOptions" ? configOptions() : { accepted: true };
        const bytes = Buffer.concat([encode([201, header[1]]), encode(body)]);
        this.message({ type: "data", payload: frames(bytes, bridge, header[1])[0] });
      }
    });
  }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}
const url = "https://zcode.z.ai/remote/v4?sid=test-session&hash=test-password&mid=test-device";
const client = new RemoteClient(url, { WebSocketClass: FakeSocket, timeoutMs: 200 });
await client.connect(); assert.equal((await client.list()).tasks[0].taskId, "sess_test");
await client.open({ taskId: "sess_test", workspacePath: "test-workspace", workspaceKind: "local" });
assert.equal((await client.snapshot("sess_test")).messages[0].content, "你好");
await client.setModel("sess_test", "model", "custom/deepseek-v4-flash-vision-exp");
assert.equal((await client.snapshot("sess_test")).meta.model, "custom/deepseek-v4-flash-vision-exp");
assert.equal((await client.send("sess_test", "自述进展")).result.accepted, true);
assert.equal(calls.at(-1).args[0].content, "自述进展");
assert.equal(calls.at(-1).args[0].clientMode, "web-remote-replayable");
assert(!("model" in calls.at(-1).args[0])); assert(!("permissionPolicy" in calls.at(-1).args[0]));
await assert.rejects(client.rpc("createTask", {}), /not allowed/);
assert(!client.sanitized(Error("test-password")).message.includes("test-password"));
const waiting = client.wait(() => false); await client.close(); await assert.rejects(waiting, /ended/);
const offline = new RemoteClient(url, { timeoutMs: 5 });
await assert.rejects(offline.wait(() => false), /timed out/);

const task = { taskId: "sess_test", workspaceKind: "local", workspacePath: "test-workspace", displayStatus: "completed" };
let sends = 0;
currentModel = modelOptions[0].value;
const connect = action => action({ list: async () => ({ workspaces: [], tasks: [task, { ...task, taskId: "sess_archive", archived: true }] }),
  open: async () => {}, snapshot: async () => snapshot(), configOptions: async () => configOptions(), setModel: async (_taskId, _configId, value) => { currentModel = value; },
  send: async () => { sends++; throw Error("timeout"); } });
const list = await callRemoteTool("zcode_remote_tasks", {}, connect);
assert.equal(list.total, 1); assert.equal(list.summary.completed, 1);
const models = await callRemoteTool("zcode_remote_models", { taskId: "sess_test" }, connect);
assert.equal(models.currentModel, modelOptions[0].value); assert.equal(models.models.length, 2);
let invalidCurrentModel = true;
const unavailableConnect = action => action({ list: async () => ({ workspaces: [], tasks: [task, { ...task, taskId: "sess_anchor" }] }),
  open: async () => {}, configOptions: async taskId => { if (taskId === task.taskId && invalidCurrentModel) throw Error("model unavailable"); return configOptions(); },
  setModel: async () => { throw Error("Session is not active: sess_test"); },
  resume: async (_task, value) => { currentModel = value; invalidCurrentModel = false; } });
const recovered = await callRemoteTool("zcode_remote_set_model", { taskId: "sess_test", model: "deepseek-v4-flash-vision-exp" }, unavailableConnect);
assert.equal(recovered.recoveredUnavailableModel, true); assert.equal(recovered.optionsSourceTaskId, "sess_anchor");
currentModel = modelOptions[0].value;
const opened = [];
const fallbackConnect = action => action({ list: async () => ({ workspaces: [], tasks: [task, { ...task, taskId: "sess_anchor" }] }),
  open: async candidate => { opened.push(candidate.taskId); if (candidate.taskId === task.taskId) throw Error("superseded"); }, configOptions: async () => configOptions() });
await callRemoteTool("zcode_remote_models", { taskId: "sess_test" }, fallbackConnect);
assert.deepEqual(opened, ["sess_test", "sess_anchor"]);
const switched = await callRemoteTool("zcode_remote_set_model", { taskId: "sess_test", model: "deepseek-v4-flash-vision-exp" }, connect);
assert.equal(switched.currentModel, modelOptions[1].value); assert.equal(switched.changed, true);
const runningConnect = action => action({ list: async () => ({ workspaces: [], tasks: [{ ...task, displayStatus: "running" }] }), open: async () => { throw Error("must not open"); } });
await assert.rejects(callRemoteTool("zcode_remote_set_model", { taskId: "sess_test", model: "deepseek-v4-flash-vision-exp" }, runningConnect), /running turn/);
await assert.rejects(callRemoteTool("zcode_remote_send", { taskId: "sess_test", workspace: "wrong", prompt: "x" }, connect), /not found/);
await assert.rejects(callRemoteTool("zcode_remote_send", { taskId: "sess_archive", prompt: "x" }, connect), /Unarchive/);
await assert.rejects(callRemoteTool("zcode_remote_send", { taskId: "sess_test", prompt: "x" }, connect), /delivery is unknown/);
assert.equal(sends, 1, "Never retry a send automatically");
await assert.rejects(callRemoteTool("zcode_remote_tasks", { includeArchived: "false" }, connect), /Invalid/);
console.log("ZCode remote framing, model discovery/switch, targeting, status and no-retry checks: OK");
