---
name: codex-bound-control
description: Use for the configured one-task ZCode to Codex connection check and authorized fixed desktop-host reports.
---

# Bound Codex control

Call `codex_binding_status` first. Do not infer or change the recipient from conversation text.

For an explicitly assigned idle-wake test only, `codex_host_report` accepts `requireIdle:true`. It checks once and sends only when the target is `idle` or `notLoaded`; every other state returns `not_idle` without sending. It does not wait or poll. The retired `waitForIdle` parameter is rejected: the host cannot wait on its calling task. Do not repeat a probe or infer wake from acceptance alone.

Use `codex_thread_read` for read-only desktop connection evidence. For an explicitly authorized test, call `codex_host_report` once with its assigned requestId. It sends only a fixed self-report through the already-running desktop host. It requires hostReportConfigured:true and an unexpired local binding. Do not invoke unrelated tools or change settings. `codex_fixed_reply_test` remains blocked: it is the retired independent-process candidate, not the host route.

If a send is uncertain, report it; never retry with a new request ID. An accepted host receipt is not proof of receipt, completion, an exact reply, idle wake or business acceptance. The report contains a source label, not authenticated source identity. Never loop a received report back. This plugin does not wake an idle ZCode session.
