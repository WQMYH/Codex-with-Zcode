# ZCode -> Codex bounded bridge plan

Status: active-task direct delivery, one-time roundtrip acknowledgement, and `notLoaded` wake all passed. The 0.2.1 self-wait probe remains a recorded failure: native `wait_threads` rejects waiting on the calling task. Version 0.2.4 performs one fresh `requireIdle` check and accepts only `idle` or `notLoaded`. Because the original receiver continuously remained active, the user-authorized confirmation-only fallback `01a06f67-c2c5-74b3-bcef-befc3d7265a0` (`文件体系整理`) was used. Its native turn returned only `ZCODE_CONFIRM_ONLY` and completed without tools. See [TEST-RESULTS.md](TEST-RESULTS.md).

## Current execution revision (supersedes legacy independent-process gates below)

The running Codex desktop provides `CODEX_APP_TOOLS_PIPE_PATH`. Its installed official `codex-app-tools/0.1.3/server.mjs` supports MCP stdio and implements native pipe framing. Read-only `tools/list` exposed `read_thread` and `send_message_to_thread`; `read_thread` returned the current desktop task with its exact cwd. This is a verified live-host route, not a new App Server process.

Reuse that adapter in 0.2.0. Local, expiring `host-config.json` under plugin data binds its pipe/script to the current task; never package or print the pipe address. Expose only a summary read and one immutable `codex_host_report`, not the host's general tool catalog. Preserve model/approval defaults. Keep the old independent-process send tool locked and retire its production read path.

Each safe request ID exclusively creates a local receipt before send; concurrent duplicates cannot both send. A crash or missing acknowledgement stays uncertain and cannot resend that ID. Do not retry under another ID. Host acceptance, message receipt, idle wake, native completion and business acceptance remain distinct.

Sequence: independent review -> deterministic checks -> update installed local plugin -> new-session fixed-report call -> observe the native Codex message -> inspect ZCode/native completion evidence. P3 requires one ZCode-origin event to trigger the target without user input or Codex model polling. Active-turn receipt alone is not idle-wake proof. No new recipient, queue resume, host restart, port opening or security-setting change is implied. The earlier two-task expansion cannot run against an unselected second task.

This adapter is coupled to the installed desktop version/process lifetime. Host restart invalidates its saved endpoint; reconnection requires fresh local setup, never endpoint guessing. This is a bounded local test, not a stable remote-control API.

0.2.1's `waitForIdle` was disproved by the live host restriction and is retired, not silently downgraded. In 0.2.4 `requireIdle:true` sends only after a fresh read confirms `idle` or `notLoaded`; any other state returns `not_idle, sent:false`, with no wait or polling. Existing receipts take precedence. The final native incoming turn must still prove idle-to-running wake; a pre-send snapshot alone is insufficient. Do not change caller identity to bypass host restrictions.

## Evidence fixed before implementation

- Source plan: `E:/Programming/AI/Agents/Codex/plugins/zcode-ops/plans/2026-09-09-zcode-side-plugin.md`.
- ZCode review: task `sess_364f3d09-4b3d-4db4-811f-3624dde5a68f`, assistant message `msg_mtu3a29b_89a7a54b-f086-4da1-9dc1-edd4a36c34a0`, 2026-09-09T12:43:11.473Z. It approves P0/P1 and asks for five corrections. Fixed replies in later turns are transport tests, not plan review.
- ZCode 3.11.2.6792 and embedded CLI 0.16.5 were observed locally. ZCode's official plugin and Hook docs confirm `.zcode-plugin/plugin.json`, local marketplace installation, `process` hooks, `ZCODE_PLUGIN_DATA`, seven Hook events, and new-session snapshot semantics.
- Codex CLI 0.153.4 was observed locally. The official App Server docs confirm stdio JSONL, `thread/read`, `thread/resume`, `turn/start`, item events, and `turn/completed`.
- Selected test task: `01a06b03-cd32-7c31-ab2d-961937a69a11`, title `推进内容台面实现探索`, host `local`, cwd `E:/Programming/AI/Agents/Documents`; Codex app status was `idle` when refreshed on 2026-09-09. Whether it is visibly open in a desktop panel is not exposed by the read API and must be recorded at live test time.

## Review corrections incorporated

1. The current official OpenAI App Server URL is reachable and verified; protocol support is not treated as proof that a new process controls the running desktop host.
2. P2 targets one explicitly selected idle task. Independent-process success passes only transport/persistence; desktop visibility is a separate observation.
3. P3 is not an open-ended framework search. Candidate A is user-triggered ZCode MCP. Hooks may observe ZCode lifecycle boundaries but cannot promise background wake. Without a verified desktop-host endpoint, the honest state is `persisted or completed, desktop wake unproved`.
4. The ZCode plugin has its own root and manifest. It cannot inherit or expose the existing Codex plugin's MCP, queue, or hooks.
5. Probe state is stored only under `ZCODE_PLUGIN_DATA` and capped at 200 metadata-only events. `teamId` is a label, not authorization. The configured ZCode source session is provenance only because ZCode MCP calls do not expose transport-authenticated caller session identity.

## Minimum implementation

One dependency-free Node MCP server exposes three tools. Production fixed-reply sending is locked before configuration access, receipt writes or process launch; no environment/config toggle unlocks it. The candidate send path described below is exercised only through an injected in-memory transport in offline tests:

- `codex_binding_status`: show the configured target, expiry, and Hook probe summary.
- `codex_thread_read`: call `thread/read` without turns and reject a cwd mismatch.
- `codex_fixed_reply_test`: construct one immutable no-tool/no-file prompt from a safe expected-reply token, resume the bound thread, start one read-only/no-approval turn, decline any server-initiated request, fail the assertion on every non-passive item, and return native turn/message IDs separately from reply matching. App Server has no turn parameter that disables every tool; read-only plus fail-closed observation is detection, not prevention.

The binding is supplied by ZCode plugin configuration: source ZCode session, target Codex thread, exact cwd, team label, expiry, expected reply, and the local Codex CLI JavaScript entrypoint. No tool can change the binding. A small JSON ledger under `ZCODE_PLUGIN_DATA` binds each request ID to all of those fields before `turn/start`; an uncertain dispatch is never retried automatically. Expiry is checked again immediately before dispatch.

The Hook probe covers `SessionStart`, `UserPromptSubmit`, and `Stop`. It records only event name, session ID, start source, and time; it returns no context, never blocks, and never reads the transcript.

## Gates

1. Independent read-only review of this implementation.
2. Deterministic self-check and manifest/MCP JSON validation.
3. Read-only App Server connection to the selected idle task; recheck task status in the Codex app immediately before use.
4. User decision: first ZCode local-marketplace installation and a new ZCode session.
5. User decision: resolve host ownership and the residual risk of a tool executing before observation; choosing an isolated task limits business impact but does not disable tools. Also address that the candidate `readOnly` and `never` overrides become defaults for later turns. Only after that decision should a live adapter be enabled and reviewed. Pass transport only when native IDs and a successful `turn/completed` are observed; pass reply assertion only when the exact token is returned with passive items only; pass desktop visibility only after the Codex app can read the new turn.
6. P3 remains blocked unless a verified host notification or scheduling path exists. No Stop loop, hidden GUI automation, host restart, port opening, or approval/model change is implied.

There is no atomic compare-and-start across the running desktop host and this independent App Server process. The bridge checks status before and after resume, while the operator must also recheck the Codex app immediately before live use; a concurrent desktop turn remains a stated P2 limitation.

## Execution evidence

- The native ZCode review was fully paged through `hasMore:false`; no new review request was needed and the source queue was not resumed.
- Independent reviewer `review_zcode_bridge` reported no blocking findings after corrections, before the initial offline test. Initial `npm test`, syntax and JSON checks passed.
- Two subsequent read-only App Server diagnostic commands were rejected before launch by automatic approval (`blocked by policy`), without a more specific reason. No live connection or reply result exists.
- Continued work locks production sending and adds in-memory JSONL transport coverage. Its review/test outcome is recorded in [TEST-RESULTS.md](TEST-RESULTS.md).

Sources checked on 2026-09-09: [ZCode Plugin](https://zcode.z.ai/en/docs/plugin), [ZCode Hooks](https://zcode.z.ai/en/docs/hooks), [Codex App Server](https://learn.chatgpt.com/docs/app-server), [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle).
