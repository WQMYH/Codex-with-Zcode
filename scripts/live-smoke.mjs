// Opt-in real transport probe: node scripts/live-smoke.mjs <existing scratch workspace>
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const cwd = process.argv[2];
assert(cwd, "Provide a scratch workspace; this probe creates one ZCode test conversation.");
const child = spawn(process.execPath, ["scripts/legacy-gateway.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.resume();
const pending = new Map();
let serial = 0;
const lines = createInterface({ input: child.stdout });
lines.on("line", line => {
  const response = JSON.parse(line), waiter = pending.get(response.id);
  if (waiter) { pending.delete(response.id); clearTimeout(waiter.timer); waiter.resolve(response); }
});
function request(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 20000);
    pending.set(id, { resolve, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}
async function call(name, args = {}) {
  const response = await request("tools/call", { name, arguments: args });
  assert(!response.error, JSON.stringify(response.error));
  assert(!response.result?.isError, JSON.stringify(response.result));
  return JSON.parse(response.result.content[0].text);
}
let sessionId;
try {
  await request("initialize", { protocolVersion: "2025-06-18" });
  await call("zcode_initialize");
  ({ sessionId } = await call("zcode_new_session", { cwd }));
  assert.equal((await call("zcode_prompt_start", { sessionId, prompt: process.argv[3] ?? "通信测试：只回复收到，然后按附加要求给出收尾标记。不要调用工具或修改文件。" })).status, "prompted");
  console.log(JSON.stringify({ sessionId, status: "submitted" }));
  let result;
  let reply = "";
  const deadline = Date.now() + 90000;
  do {
    await new Promise(resolve => setTimeout(resolve, 2000));
    result = await call("zcode_task_poll", { sessionId });
    assert.equal(result.sessionId, sessionId);
    assert.equal(result.readError, undefined);
    for (const event of JSON.parse(result.event.content[0].text).events ?? []) {
      if (event.type === "update" && event.update?.sessionUpdate === "agent_message_chunk" && event.update.content?.type === "text") reply += event.update.content.text;
    }
  } while (!result.terminal && Date.now() < deadline);
  console.log(JSON.stringify({ sessionId, status: result.status, terminal: result.terminal, receiptObserved: result.receiptObserved, error: result.error ?? null, reply }));
  assert(result.terminal, "No terminal event within 90 seconds");
  const state = await call("zcode_bridge_session_status", { sessionId });
  assert.equal(state.state, result.status);
  console.log("Live send / poll / terminal / status consistency: OK");
} finally {
  if (sessionId) await call("zcode_close_session", { sessionId }).catch(() => {});
  await call("zcode_shutdown").catch(() => {});
  child.stdin.end();
  for (const waiter of pending.values()) clearTimeout(waiter.timer);
}
