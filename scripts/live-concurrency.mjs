// Opt-in: node scripts/live-concurrency.mjs <installed-plugin-root> <scratch-task-id> <stable-run-id> [read-only-watch-task-ids...]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const [root, taskId, runId, ...watchIds] = process.argv.slice(2);
assert(root && /^sess_[\w-]+$/.test(taskId) && /^[\w-]{1,64}$/.test(runId), "Explicit installed root, scratch task and stable run ID required");
assert(watchIds.length <= 7 && watchIds.every(id => /^sess_[\w-]+$/.test(id)));
const version = JSON.parse(readFileSync(join(root, ".codex-plugin/plugin.json"))).version;
const teams = [0, 1].map(i => `live-${runId}-${i}`), consumers = ["reader-a", "reader-b"].map(id => `${runId}-${id}`);
const terminal = state => ["completed", "released", "cancelled"].includes(state);
const log = value => console.log(JSON.stringify(value));
function peer() {
  const child = spawn(process.execPath, [resolve(root, "scripts/mcp-gateway.mjs")], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stderr.resume();
  const pending = new Map(); let serial = 0;
  createInterface({ input: child.stdout }).on("line", line => {
    const response = JSON.parse(line), waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id); clearTimeout(waiter.timer);
    response.error ? waiter.reject(Error(response.error.message)) : waiter.resolve(response.result);
  });
  const fail = () => { for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(Error("MCP peer exited")); } pending.clear(); };
  child.once("exit", fail); child.once("error", fail);
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error("MCP timeout; do not resend an uncertain request")); }, 60000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  return { child, request,
    call: async (name, args = {}) => JSON.parse((await request("tools/call", { name, arguments: args })).content[0].text),
    close: () => { child.stdin.end(); child.kill(); fail(); } };
}

const peers = Array.from({ length: 3 }, peer);
let resumeRevision, receipts = [], initial, latestPages = [];
try {
  await Promise.all(peers.map(async p => {
    assert.equal((await p.request("initialize", { protocolVersion: "2025-06-18" })).serverInfo.version, version);
    p.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const { tools } = await p.request("tools/list");
    assert(tools.find(t => t.name === "zcode_read").inputSchema.properties.consumerId, "Peer is not the repaired version");
  }));
  initial = await peers[0].call("zcode_read", { view: "inbox" });
  assert(initial.worker.paused && !initial.worker.running && !initial.worker.starting, "Begin with an explicitly paused, stopped queue");
  assert(initial.messages.every(m => terminal(m.state)), "Do not dispatch unrelated pending messages during a probe");
  const inventory = await peers[0].call("zcode_tasks", { limit: 500 });
  const scratch = inventory.tasks.find(t => t.taskId === taskId);
  assert(scratch && !scratch.archived && ["idle", "completed"].includes(scratch.status), "Scratch task must be idle and unarchived");
  const watched = [...new Set([taskId, ...watchIds])];
  assert(watched.every(id => inventory.tasks.some(t => t.taskId === id)), "Watch target missing from live desktop inventory");
  log({ phase: "ready", version, scratch: { taskId, title: scratch.title }, watched: watched.length, runId });
  const sends = teams.map((teamId, i) => ({ requestId: `${teamId}-request`, taskIds: [taskId], teamId,
    prompt: `这是 ZCode Ops 的受限并发往返测试，不继续此前任务。请只回复 LIVE_PARALLEL_${i + 1}_OK。不要调用工具、修改文件、创建任务或继续其他工作。`,
    context: { sourceAgent: "codex-test", goal: "验证真实并发入队、顺序派发和回复回流", constraints: "仅回复固定测试文本，不执行任何其他动作" } }));
  const submitted = await Promise.all([peers[0].call("zcode_send", sends[0]), peers[1].call("zcode_send", sends[1]), peers[2].call("zcode_send", sends[0])]);
  assert.equal(submitted[0].messages[0].messageId, submitted[2].messages[0].messageId, "Concurrent retry duplicated a request");
  assert.equal(submitted[0].deduplicated !== submitted[2].deduplicated, true);
  receipts = submitted.slice(0, 2).map(r => r.messages[0]);
  log({ phase: "queued", receipts, duplicateSuppressed: true });
  const streams = teams.flatMap(teamId => consumers.map(consumerId => ({ view: "inbox", teamId, consumerId })));
  latestPages = await Promise.all(streams.map((s, i) => peers[i % 3].call("zcode_read", s)));
  const events = new Map(latestPages.flatMap(p => p.events).map(e => [e.cursor, e]));
  const resumed = await peers[0].call("zcode_control", { action: "resume", scope: "all", expectedRevision: initial.worker.controlRevision });
  resumeRevision = resumed.controlRevision;
  const deadline = performance.now() + 180000;
  let cycles = 0, reads = 0, previous = "";
  while (performance.now() < deadline) {
    const work = streams.map((s, i) => peers[i % 3].call("zcode_read", { ...s, cursor: latestPages[i].cursor, waitMs: 3000 }));
    if (cycles % 3 === 0) {
      work.push(peers[1].call("zcode_read", { view: "conversation", taskIds: watched, messageLimit: 1 }).then(page => {
        assert.equal(page.errors.length, 0, "Concurrent conversation read failed"); assert.equal(page.missing.length, 0);
        reads++; return null;
      }));
      work.push(peers[2].call("zcode_tasks", { workspace: scratch.workspace, limit: 100 }).then(() => { reads++; return null; }));
    }
    const results = await Promise.all(work);
    latestPages = results.slice(0, streams.length);
    for (const page of latestPages) { assert(!page.historyGap); for (const event of page.events) events.set(event.cursor, event); }
    const states = receipts.map(r => latestPages.flatMap(p => p.messages).find(m => m.messageId === r.messageId)?.state);
    if (JSON.stringify(states) !== previous) { previous = JSON.stringify(states); log({ phase: "progress", states, concurrentRemoteReads: reads }); }
    if (states.every(s => s === "completed")) break;
    assert(!states.some(s => s === "needs_attention" || s === "uncertain"), "Delivery needs review; no automatic resend");
    cycles++; await delay(500);
  }
  latestPages = await Promise.all(streams.map((s, i) => peers[i % 3].call("zcode_read", s)));
  for (const page of latestPages) { assert(!page.hasMore); assert(!page.historyGap); for (const e of page.events) events.set(e.cursor, e); }
  assert(latestPages.every(p => p.messages.length === 1 && p.messages[0].state === "completed"), "Timed out before native completion");
  const ordered = [...events.values()].sort((a, b) => a.cursor - b.cursor);
  const dispatches = ordered.filter(e => e.kind === "delivery" && e.payload.state === "dispatching");
  assert.equal(dispatches.length, 2);
  const firstEnd = ordered.find(e => e.messageId === dispatches[0].messageId && e.kind === "delivery" && e.payload.state === "completed");
  assert(firstEnd.cursor < dispatches[1].cursor, "Same-task FIFO was violated");
  for (let i = 0; i < receipts.length; i++) {
    const response = ordered.filter(e => e.messageId === receipts[i].messageId && e.kind === "message" && e.payload.role === "assistant").map(e => e.payload.content).join("");
    assert.equal(response.trim(), `LIVE_PARALLEL_${i + 1}_OK`);
  }
  for (let i = 0; i < streams.length; i++) {
    const envelope = latestPages[i].envelopes[0]; assert(envelope.receipt.complete);
    const result = await peers[i % 3].call("zcode_control", { action: "acknowledge_message", messageId: envelope.messageId,
      consumerId: streams[i].consumerId, throughEvent: envelope.receipt.throughEvent });
    assert.equal(result.eligibleForPruning, i % 2 === 1, "Each reader must confirm independently");
  }
  log({ phase: "passed", version, messages: receipts.length, duplicateSuppressed: true, sameTaskFifo: true,
    consumers: consumers.length, watchedTasks: watched.length, concurrentRemoteReads: reads,
    dispatchOrder: dispatches.map(e => ({ messageId: e.messageId, event: e.cursor })), firstCompletionEvent: firstEnd.cursor });
} finally {
  try {
    if (resumeRevision !== undefined) {
      const current = await peers[0].call("zcode_read", { view: "inbox" });
      if (current.worker.controlRevision === resumeRevision) {
        await peers[0].call("zcode_control", { action: "pause", scope: "all", expectedRevision: resumeRevision });
        log({ phase: "restored_pause" });
      } else log({ phase: "control_changed_externally", restored: false });
    }
  } finally { peers.forEach(p => p.close()); }
}
