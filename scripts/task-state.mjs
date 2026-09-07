// State comes from MCACP protocol events; response text is untrusted payload.
export function decodeEvents(result) {
  if (result?.isError) return null;
  for (const block of result?.content ?? []) {
    if (block.type !== "text") continue;
    try {
      const data = JSON.parse(block.text);
      if (Array.isArray(data?.events)) return data.events;
    } catch {}
  }
  return null;
}

export function observeEvents(states, events, now = new Date().toISOString()) {
  for (const event of events) {
    if (!event || typeof event.sessionId !== "string") continue;
    let entry = states.get(event.sessionId);
    if (!entry) { entry = { state: "unknown", terminal: false }; states.set(event.sessionId, entry); }
    if (entry.terminal) continue;
    entry.lastObservedAt = now;
    if (event.type === "error") {
      Object.assign(entry, { state: "failed", terminal: true, error: event.message });
    } else if (event.type === "complete") {
      entry.stopReason = event.stopReason;
      entry.terminal = true;
      entry.receiptObserved = Boolean(entry.marker && entry.replyTail?.trimEnd().endsWith(entry.marker));
      entry.state = event.stopReason === "cancelled" ? "cancelled"
        : event.stopReason === "end_turn" && entry.receiptObserved ? "completed_receipt" : "turn_completed";
    } else if (event.type === "permission_request") {
      entry.state = "waiting_permission";
    } else if (event.type === "update" && event.update?.sessionUpdate === "agent_message_chunk") {
      const content = event.update.content;
      if (entry.marker && content?.type === "text" && typeof content.text === "string") {
        // ponytail: bounded reply suffix; receipts must be at the end of the answer.
        entry.replyTail = ((entry.replyTail ?? "") + content.text).slice(-Math.max(1024, entry.marker.length * 2));
      }
      if (entry.state !== "waiting_permission" && entry.state !== "cancel_requested") entry.state = "running";
    }
  }
}

export function taskSnapshot(states, sessionId, staleAfterMinutes = 30, now = Date.now()) {
  const entry = states.get(sessionId);
  if (!entry) return { sessionId, state: "untracked", terminal: false, receiptObserved: false };
  const lastActivity = entry.lastObservedAt ?? entry.startedAt;
  const stale = !entry.terminal && lastActivity && now - Date.parse(lastActivity) > staleAfterMinutes * 60000;
  return {
    sessionId, state: entry.state, terminal: Boolean(entry.terminal),
    activity: stale ? "unconfirmed_stale" : "observed",
    startedAt: entry.startedAt ?? null, lastObservedAt: entry.lastObservedAt ?? null,
    stopReason: entry.stopReason ?? null, receiptObserved: Boolean(entry.receiptObserved),
    ...(entry.error ? { error: entry.error } : {}),
    stateWarning: "Terminal means this turn ended. A receipt is the agent's completion claim, not acceptance of its work. Stale activity does not prove interruption."
  };
}
