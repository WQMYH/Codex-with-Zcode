import assert from "node:assert/strict";
import { decodeEvents, observeEvents, taskSnapshot } from "./task-state.mjs";

const marker = "[zcode-ops:complete:test]";
const states = new Map();
const reset = () => states.set("s", { marker, state: "submitted", terminal: false, startedAt: "2026-09-06T00:00:00Z" });
const event = (type, rest = {}) => ({ sessionId: "s", type, ...rest });
const chunk = text => event("update", { update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } } });
const mcp = events => ({ content: [{ type: "text", text: JSON.stringify({ events }) }] });
const accept = events => observeEvents(states, decodeEvents(mcp(events)), "2026-09-06T00:00:01Z");
reset();
accept([event("update", { update: { sessionUpdate: "session_info_update", title: marker } }), chunk("The string turn.failed is an example.")]);
assert.equal(states.get("s").terminal, false);
assert.equal(states.get("s").state, "running");
accept([event("error", { message: "Internal error" })]); // Actual captured MCACP failure shape.
assert.equal(states.get("s").state, "failed");
accept([]);
assert.equal(taskSnapshot(states, "s").terminal, true);
reset();
accept([chunk("完成\n" + marker.slice(0, 12))]);
accept([chunk(marker.slice(12))]);
assert.equal(states.get("s").terminal, false); // Text alone cannot end a protocol turn.
accept([event("complete", { stopReason: "end_turn" })]);
assert.equal(states.get("s").state, "completed_receipt");
reset();
accept([event("complete", { stopReason: "end_turn" })]);
assert.equal(states.get("s").state, "turn_completed"); // Missing receipt still has a known turn end.
reset();
accept([chunk(marker), event("error", { message: "failed after text" })]);
assert.equal(states.get("s").state, "failed");
reset();
accept([event("permission_request")]);
assert.equal(states.get("s").state, "waiting_permission");
assert.equal(taskSnapshot(states, "s", 30, Date.parse("2026-09-06T01:00:00Z")).activity, "unconfirmed_stale");
assert.equal(taskSnapshot(states, "s").terminal, false);
accept([event("complete", { stopReason: "cancelled" })]);
assert.equal(states.get("s").state, "cancelled");
assert.equal(decodeEvents({ isError: true, ...mcp([event("error")]) }), null);
assert.equal(decodeEvents({ content: [{ type: "text", text: "turn.failed" }] }), null);
assert.equal(taskSnapshot(states, "other").state, "untracked");
console.log("ZCode protocol state regression: OK");
