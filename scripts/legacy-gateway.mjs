// Opt-in legacy diagnostics only; not registered in the default plugin.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { decodeEvents, observeEvents, taskSnapshot } from "./task-state.mjs";
import { remoteTools, callRemoteTool } from "./remote-tools.mjs";
import { configTools, callConfigTool } from "./config.mjs";
import { queueTools, callQueueTool } from "./message-queue.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(resolve(root, ".codex-plugin", "plugin.json"), "utf8")).version;
const mcacp = resolve(root, "node_modules", "mcacp", "dist", "index.js");
const zcodeAcp = resolve(root, "node_modules", "zcode-acp-server", "dist", "cli.js");
const zcodeEnv = JSON.parse(readFileSync(resolve(root, "mcacp.json"), "utf8")).agent_servers.zcode.env;
// ACP 0.21.0 hardcodes native yolo and writes desktop index rows directly.
// Suspend every entry that can create/resume/send until the desktop route is verified.
const suspendedTools = new Set(["zcode_new_session", "zcode_load_session", "zcode_prompt_start"]);
const TOOLS = [
  ["zcode_initialize", "Start the fixed local ZCode agent.", {}],
  ["zcode_shutdown", "Stop the local ZCode agent.", {}],
  ["zcode_new_session", "Create a session in an existing absolute workspace.", { cwd: { type: "string" } }, ["cwd"]],
  ["zcode_load_session", "Load a saved session in an existing absolute workspace.", { sessionId: { type: "string" }, cwd: { type: "string" } }, ["sessionId", "cwd"]],
  ["zcode_list_sessions", "List sessions saved by this bridge.", {}],
  ["zcode_close_session", "Close an active session without deleting its record.", { sessionId: { type: "string" } }, ["sessionId"]],
  ["zcode_prompt_start", "Start a text prompt without waiting.", { sessionId: { type: "string" }, prompt: { type: "string" } }, ["sessionId", "prompt"]],
  ["zcode_prompt", "Wait for the next event from a prompted session.", { sessionId: { type: "string" } }, ["sessionId"]],
  ["zcode_prompt_events", "Read queued events without waiting.", { sessionId: { type: "string" } }, ["sessionId"]],
  ["zcode_task_poll", "Read queued ZCode events as an opaque task envelope: status, terminal, and unmodified event payload.", { sessionId: { type: "string" } }, ["sessionId"]],
  ["zcode_events", "Wait up to 120 seconds for events from any session.", { timeoutMs: { type: "integer", minimum: 0, maximum: 120000 } }],
  ["zcode_cancel", "Cancel an in-progress prompt.", { sessionId: { type: "string" } }, ["sessionId"]],
  ["zcode_desktop_sessions_status", "Legacy name: read the native CLI session inventory, NOT the desktop task list or UI running state.", { activeWithinMinutes: { type: "integer", minimum: 1, maximum: 1440 }, limit: { type: "integer", minimum: 1, maximum: 500 } }],
  ["zcode_bridge_session_status", "Read receipt-based state for one prompt started through this bridge. Missing receipt is not proof of interruption.", { sessionId: { type: "string" }, staleAfterMinutes: { type: "integer", minimum: 1, maximum: 1440 } }, ["sessionId"]],
  ["zcode_runtime_status", "Read the fixed ZCode agent status.", {}]
].filter(([name]) => !suspendedTools.has(name)).map(([name, description, properties, required]) => ({
  name, description, inputSchema: { type: "object", properties, ...(required ? { required } : {}), additionalProperties: false }
}));
const names = new Set(TOOLS.map(({ name }) => name));
for (const tool of remoteTools) { TOOLS.push(tool); names.add(tool.name); }
for (const tool of configTools) { TOOLS.push(tool); names.add(tool.name); }
for (const tool of queueTools) { TOOLS.push(tool); names.add(tool.name); }
let inner;
let serial = 0;
const pending = new Map();
const promptReceipts = new Map();

function output(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function failure(id, code, message) { output({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }); }
function nonempty(value, field) {
  if (typeof value !== "string" || !value) throw new Error(`${field} must be a non-empty string`);
  return value;
}
function workspace(value) {
  const cwd = nonempty(value, "cwd");
  if (!isAbsolute(cwd) || !existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error("cwd must be an existing absolute directory");
  return cwd;
}
function boundedInteger(value, fallback, name, minimum, maximum) {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  return result;
}
function readDesktopSessions(args = {}) {
  const activeWithinMinutes = boundedInteger(args.activeWithinMinutes, 30, "activeWithinMinutes", 1, 1440);
  const limit = boundedInteger(args.limit, 100, "limit", 1, 500);
  if (!existsSync(zcodeAcp)) throw new Error("ZCode ACP dependency is missing. Run npm ci --ignore-scripts in plugins/zcode-ops.");
  return new Promise((resolveSessions, rejectSessions) => {
    const child = spawn(process.execPath, [zcodeAcp, "server"], {
      cwd: root,
      env: { ...process.env, ...zcodeEnv },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let complete = false;
    const finish = (error, value) => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      child.kill();
      error ? rejectSessions(error) : resolveSessions(value);
    };
    const timeout = setTimeout(() => finish(new Error("ZCode native session/list timed out")), 30000);
    child.on("error", finish);
    child.on("exit", (code, signal) => { if (!complete) finish(new Error(`ZCode native session/list exited (code=${code}, signal=${signal})`)); });
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.id === 1) {
        if (message.error) return finish(new Error(message.error.message));
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/list", params: {} })}\n`);
      }
      if (message.id === 2) {
        if (message.error) return finish(new Error(message.error.message));
        const rows = (message.result?.sessions ?? []).slice(0, limit);
    const cutoff = Date.now() - activeWithinMinutes * 60_000;
        const summary = { recently_active: 0, stale: 0 };
    const sessions = rows.map((row) => {
          const status = Date.parse(row.updatedAt) >= cutoff ? "recently_active" : "stale";
      summary[status] += 1;
          return { id: row.sessionId, workspace: row.cwd, title: row.title, status, updatedAt: row.updatedAt };
    });
        finish(null, {
      source: "zcode_native_session_list",
      desktopVisibility: "unverified",
      queriedAt: new Date().toISOString(),
      activeWithinMinutes,
      summary,
      correlation: "Join with Codex task status by workspace only; no one-to-one session mapping exists.",
          stateWarning: "This is the CLI session inventory, not the desktop task list. recently_active is not running; a listed session may be invisible in the desktop. The ACP list does not expose archived or compacting state.",
      sessions
        });
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1, clientInfo: { name: "zcode-ops", version }, clientCapabilities: {} } })}\n`);
  });
}
function addCompletionReceipt(sessionId, prompt) {
  const marker = `[zcode-ops:complete:${randomUUID()}]`;
  return {
    marker,
    prompt: `${prompt}\n\nWhen you have completed this task, end your final response with exactly ${marker}. If you cannot complete it, do not emit this marker.`
  };
}
function observeReceipt(sessionId, result) {
  const events = decodeEvents(result);
  if (events) observeEvents(promptReceipts, sessionId ? events.filter(e => e?.sessionId === sessionId) : events);
}
function taskEnvelope(sessionId, event) {
  observeReceipt(sessionId, event);
  const { state, ...snapshot } = taskSnapshot(promptReceipts, sessionId);
  return {
    ...snapshot,
    status: state,
    ...(decodeEvents(event) === null ? { readError: true } : {}),
    receivedAt: new Date().toISOString(),
    event
  };
}
async function bridgeSessionStatus(args = {}) {
  const sessionId = nonempty(args.sessionId, "sessionId");
  const staleAfterMinutes = boundedInteger(args.staleAfterMinutes, 30, "staleAfterMinutes", 1, 1440);
  return taskSnapshot(promptReceipts, sessionId, staleAfterMinutes);
}
function mapTool(name, args = {}) {
  if (!args || typeof args !== "object") throw new Error("tool arguments must be an object");
  switch (name) {
    case "zcode_initialize": return ["initialize", { agentId: "zcode" }];
    case "zcode_shutdown": return ["shutdown", { agentId: "zcode" }];
    case "zcode_new_session": return ["new_session", { agentId: "zcode", cwd: workspace(args.cwd), permissionPolicy: "operator" }];
    case "zcode_load_session": return ["load_session", { agentId: "zcode", sessionId: nonempty(args.sessionId, "sessionId"), cwd: workspace(args.cwd) }];
    case "zcode_list_sessions": return ["list_sessions", { agentId: "zcode" }];
    case "zcode_close_session": return ["close_session", { sessionId: nonempty(args.sessionId, "sessionId") }];
    case "zcode_prompt_start": {
      const sessionId = nonempty(args.sessionId, "sessionId");
      const receipt = addCompletionReceipt(sessionId, nonempty(args.prompt, "prompt"));
      return ["prompt_start", { sessionId, prompt: receipt.prompt }, receipt.marker];
    }
    case "zcode_prompt": return ["prompt", { sessionId: nonempty(args.sessionId, "sessionId") }];
    case "zcode_prompt_events": return ["prompt_events", { sessionId: nonempty(args.sessionId, "sessionId") }];
    case "zcode_cancel": return ["cancel", { sessionId: nonempty(args.sessionId, "sessionId") }];
    case "zcode_runtime_status": return ["get_agent_status", { agentId: "zcode" }];
    case "zcode_events": {
      const timeoutMs = args.timeoutMs ?? 30000;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 120000) throw new Error("timeoutMs must be an integer from 0 to 120000");
      return ["events", { timeoutMs }];
    }
    default: throw new Error(`Tool not allowed: ${name}`);
  }
}
function writeInner(message) {
  if (!inner?.stdin?.writable) throw new Error("MCACP is not running");
  inner.stdin.write(`${JSON.stringify(message)}\n`);
}
function requestInner(method, params, timeoutMs = 125000) {
  const id = `zcode-ops-${++serial}`;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => { pending.delete(id); rejectRequest(new Error(`MCACP timed out: ${method}`)); }, timeoutMs);
    pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer });
    try { writeInner({ jsonrpc: "2.0", id, method, params }); }
    catch (error) { clearTimeout(timer); pending.delete(id); rejectRequest(error); }
  });
}
function failPending(error) {
  for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
  pending.clear();
}
async function startInner() {
  if (inner) return;
  if (!existsSync(mcacp)) throw new Error("Dependencies are missing. Run npm ci --ignore-scripts in plugins/zcode-ops.");
  const env = { ...process.env };
  delete env.ZCODE_ACP_REMOTE;
  delete env.ZCODE_ACP_REMOTE_TOKEN;
  inner = spawn(process.execPath, [mcacp], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  inner.stderr.on("data", (data) => process.stderr.write(`[zcode-ops] ${data}`));
  inner.on("error", failPending);
  inner.on("exit", (code, signal) => { failPending(new Error(`MCACP exited (code=${code}, signal=${signal})`)); inner = undefined; });
  createInterface({ input: inner.stdout }).on("line", (line) => {
    let message; try { message = JSON.parse(line); } catch { return; }
    const item = pending.get(String(message.id));
    if (!item) {
      if (message.id !== undefined && message.method) writeInner({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Inner client requests are disabled" } });
      return;
    }
    clearTimeout(item.timer); pending.delete(String(message.id));
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result);
  });
  await requestInner("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "zcode-ops", version } });
  writeInner({ jsonrpc: "2.0", method: "notifications/initialized" });
}
async function stopInner() {
  if (!inner) return;
  try { await requestInner("tools/call", { name: "shutdown", arguments: { agentId: "zcode" } }, 5000); } catch {}
  inner.kill();
}
async function handle(message) {
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return;
  const { id, method, params = {} } = message;
  if (method === "initialize") return output({ jsonrpc: "2.0", id, result: { protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "zcode-ops", version } } });
  if (method === "notifications/initialized") return;
  if (method === "ping") return output({ jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return output({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method !== "tools/call") return id === undefined ? undefined : failure(id, -32601, `Method not supported: ${method}`);
  if (suspendedTools.has(params.name)) return failure(id, -32001, "ZCode ACP execution is suspended: upstream creates yolo sessions and writes the desktop index directly. Use the desktop's own task flow; no session was created, loaded, or prompted by this call.");
  if (!names.has(params.name)) return failure(id, -32601, `Tool not allowed: ${String(params.name)}`);
  try {
    if (queueTools.some(tool => tool.name === params.name)) return output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await callQueueTool(params.name, params.arguments), null, 2) }] } });
    if (configTools.some(tool => tool.name === params.name)) return output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await callConfigTool(params.name, params.arguments), null, 2) }] } });
    if (remoteTools.some(tool => tool.name === params.name)) return output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await callRemoteTool(params.name, params.arguments), null, 2) }] } });
    if (params.name === "zcode_desktop_sessions_status") return output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await readDesktopSessions(params.arguments), null, 2) }] } });
    if (params.name === "zcode_bridge_session_status") return output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(await bridgeSessionStatus(params.arguments), null, 2) }] } });
    if (params.name === "zcode_task_poll") {
      const sessionId = nonempty(params.arguments?.sessionId, "sessionId");
      await startInner();
      const event = await requestInner("tools/call", { name: "prompt_events", arguments: { sessionId } });
      return output({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(taskEnvelope(sessionId, event), null, 2) }] } });
    }
    const [name, args, receiptMarker] = mapTool(params.name, params.arguments);
    await startInner();
    const result = await requestInner("tools/call", { name, arguments: args });
    if (params.name === "zcode_prompt_start" && !result.isError) promptReceipts.set(args.sessionId, { marker: receiptMarker, state: "submitted", terminal: false, startedAt: new Date().toISOString(), lastObservedAt: null });
    if (params.name === "zcode_prompt" || params.name === "zcode_prompt_events") observeReceipt(args.sessionId, result);
    if (params.name === "zcode_events") observeReceipt(null, result);
    if (params.name === "zcode_cancel" && !result.isError && promptReceipts.has(args.sessionId) && !promptReceipts.get(args.sessionId).terminal) promptReceipts.get(args.sessionId).state = "cancel_requested";
    output({ jsonrpc: "2.0", id, result });
  } catch (error) { failure(id, -32602, error instanceof Error ? error.message : String(error)); }
}
const input = createInterface({ input: process.stdin });
input.on("line", (line) => { try { void handle(JSON.parse(line)); } catch { failure(null, -32700, "Invalid JSON-RPC"); } });
input.on("close", () => { void stopInner(); });
process.once("SIGINT", () => { void stopInner().finally(() => process.exit(0)); });
process.once("SIGTERM", () => { void stopInner().finally(() => process.exit(0)); });
