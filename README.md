# ZCode Ops

Current status (2026-09-07): **ACP execution suspended; desktop creation not implemented.** `zcode_new_session`, `zcode_load_session`, and `zcode_prompt_start` are omitted from tool discovery and rejected before backend startup, including calls using an old tool name. The dependency hardcodes native `mode: "yolo"` and writes the desktop index directly; MCACP `operator` does not establish end-to-end permission preservation. Existing tasks and data have not been deleted or modified by this suspension.

The remaining inventory/event tools are diagnostic. The legacy name `zcode_desktop_sessions_status` returns the native CLI session inventory, not the desktop's visible task list or authoritative running status. A native session or a row in the desktop index does not establish desktop creation. A verified native desktop route is required before execution can be restored. Reinstall and start a new Codex task to load this version; already-running older gateways are not hot-patched.

```powershell
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run smoke
```

The configured ZCode CLI is `D:\Programs\ZCode\resources\glm\zcode.cjs`. If it moves, change `mcacp.json` before querying the native inventory.

Both execution and inventory use `mcacp.json`'s agent environment. On this Windows installation, child-only `HOME=E:\Programming\IDE` routes ACP credentials and task-index access to the desktop's `.zcode/v2`; `ZCODE_DATA_BASE_DIR` routes native shared credentials to the same location. `USERPROFILE` and the native CLI database remain unchanged at `C:\Users\WQ\.zcode\cli\db\db.sqlite`, which already contains the desktop sessions. Do not relocate that database merely to match the desktop index. No credentials are copied or logged, and no system environment is changed.

The earlier claim that new sessions preserve `operator` permissions was incorrect: the underlying ACP sets `yolo` during native creation. No approval tool is exposed. The subsequent phases and correction record remain in [the plan](../../plans/2026-09-05-zcode-ops-integration-plan.md).

`zcode_desktop_sessions_status` starts ZCode's local ACP bridge and calls its native `session/list`. It returns only id, workspace, title, and update time—never message text. `recently_active` means a recent native update time, not that the task is running. The native list does not expose archived or compacting state. Correlate with Codex task state by workspace only.

Historical headless protocol behavior (not currently available for new prompts): `zcode_prompt_start` added a unique completion receipt. State is in-memory for the gateway process. `zcode_task_poll` consumes events; `zcode_bridge_session_status` reads the last observed state without consuming events or starting another ZCode backend. All event readers (`zcode_prompt`, `zcode_prompt_events`, `zcode_events`, `zcode_task_poll`) update the same state. They consume the same queue, so choose one reader per session.

`zcode_task_poll` returns `{ sessionId, status, terminal, receivedAt, event, ... }`. `event` is the unmodified MCP result. The bridge reads only MCACP protocol fields and the assistant's reply suffix; it does not depend on model identity.

| Evidence | State | Terminal |
| --- | --- | --- |
| Prompt accepted | `submitted` | false |
| Assistant text arrives | `running` | false |
| `permission_request` event | `waiting_permission` | false |
| Cancel notification sent | `cancel_requested` | false |
| `complete`, stopReason `cancelled` | `cancelled` | true |
| `error` event | `failed` | true |
| `complete` event | `turn_completed` | true |
| `complete`, `end_turn`, assistant reply ends with receipt | `completed_receipt` | true |

`terminal` means the turn ended, not that the task passed acceptance. A receipt is the agent's completion claim. Empty polling and stale activity do not prove interruption. Read/transport errors are returned separately (`readError` or JSON-RPC error); ordinary text containing `turn.failed` is never a protocol failure. Bridge session ids and native desktop ids may differ, so stale activity uses observed bridge timestamps rather than joining those ids.

Verification: `npm run smoke` includes protocol, profile-routing, and suspended-entry regression checks. The historical `live-smoke.mjs` is not a desktop acceptance test and cannot run while execution is suspended. Do not remove the suspension merely to make that probe pass.
