import assert from "node:assert/strict";
import { encode, decode, frames, FrameReader, checksum } from "./remote-codec.mjs";
import { RemoteClient, validateRemoteUrl } from "./remote-client.mjs";
import { normalizeTask, callRemoteTool } from "./remote-tools.mjs";

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

const calls = [];
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
        const body = header[3] === "getTaskSnapshot" ? { messages: [{ id: "answer", role: "assistant", content: "你好" }], runtime: {}, history: { totalMessages: 1 } } : { accepted: true };
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
const connect = action => action({ list: async () => ({ workspaces: [], tasks: [task, { ...task, taskId: "sess_archive", archived: true }] }), open: async () => {}, send: async () => { sends++; throw Error("timeout"); } });
const list = await callRemoteTool("zcode_remote_tasks", {}, connect);
assert.equal(list.total, 1); assert.equal(list.summary.completed, 1);
await assert.rejects(callRemoteTool("zcode_remote_send", { taskId: "sess_test", workspace: "wrong", prompt: "x" }, connect), /not found/);
await assert.rejects(callRemoteTool("zcode_remote_send", { taskId: "sess_archive", prompt: "x" }, connect), /Unarchive/);
await assert.rejects(callRemoteTool("zcode_remote_send", { taskId: "sess_test", prompt: "x" }, connect), /delivery is unknown/);
assert.equal(sends, 1, "Never retry a send automatically");
await assert.rejects(callRemoteTool("zcode_remote_tasks", { includeArchived: "false" }, connect), /Invalid/);
console.log("ZCode remote framing, transport, targeting, status and no-retry checks: OK");
