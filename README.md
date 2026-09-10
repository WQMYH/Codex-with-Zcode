[EN](README.md) | [中文](README.zh-CN.md)

# ZCode Ops

ZCode Ops is the Codex-side MCP plugin for inspecting existing ZCode Desktop tasks, sending authorized messages, reading replies, and managing a durable delivery queue. It does not open a new desktop window or create a new task.

## 1. Overview

This repository distributes two independent plugins for opposite sides of the same workflow:

- `zcode-ops/` at the repository root is the Codex plugin. It reads, queues, and controls existing ZCode Desktop tasks through Mobile Remote Control.
- [`zcode-codex-bridge/`](zcode-codex-bridge/README.md) is the ZCode plugin. It sends one bounded, fixed report to a configured Codex Desktop task through the official local adapter.

Keep their manifests and runtime boundaries separate. Install both only when a workflow needs two-way coordination.

## 2. Requirements

- Windows
- ZCode Desktop with Mobile Remote Control enabled (tested with ZCode 3.11.2)
- Codex Desktop with local plugin support
- Node.js 24 or newer

The Sharing Link is an access credential. It is stored only in the local `CODEX_HOME/zcode-ops/config.json`; it is never part of this repository or an install package.

## 3. Installation

### Codex plugin

If the local marketplace `gameops-local` is already configured:

~~~powershell
codex plugin add zcode-ops@gameops-local
~~~

To inspect the source:

~~~powershell
git clone https://github.com/WQMYH/Codex-with-Zcode.git
Set-Location Codex-with-Zcode
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run smoke
~~~

A clone is source code, not an installation. Register the repository in the local marketplace used by your Codex installation, then install the plugin. This repository does not currently provide a one-click public marketplace.

When updating a local installation, refresh the plugin cache version and reinstall from the marketplace that actually serves it. Confirm the active tool version before testing; an installed copy and the currently loaded MCP process are separate states.

### ZCode companion plugin

In ZCode, add the repository subdirectory below as a local marketplace and install `zcode-codex-bridge` from `zcode-codex-local`:

~~~text
<repository>/zcode-codex-bridge
~~~

Follow the companion [README](zcode-codex-bridge/README.md) for its expiring Codex binding, fixed reply contract, `requireIdle` mode, and live evidence. Its independent checks are in [TEST-RESULTS.md](zcode-codex-bridge/TEST-RESULTS.md).

## 4. Connection and configuration

When a task needs the remote connection, provide the current Sharing Link through the ZCode Ops tools:

~~~javascript
zcode_config_set({ sharingLink: "https://zcode.z.ai/remote/v4?..." });
zcode_config_status({});
// Explicitly clear the local credential:
zcode_config_set({ sharingLink: null });
~~~

Saving a link does not probe it. A connection is attempted only when a later operation needs it; update the link after an actual connection failure. Installation and startup do not request credentials automatically.

## 5. Usage

The default entry point exposes eight tools:

| Tool | Purpose |
| --- | --- |
| `zcode_tasks` | List real tasks, workspaces, and native status. |
| `zcode_read` | Read one or more conversations or the durable inbox, with cursor-based continuation and bounded waiting. |
| `zcode_send` | Enqueue an authorized prompt for 1–8 selected tasks and return a durable receipt. |
| `zcode_control` | Pause or resume delivery, cancel unsent messages, release a blocked item, or request a native stop. |
| `zcode_models` | Read the models advertised by a task. |
| `zcode_set_model` | Select an advertised model for an idle task. |
| `zcode_config_status` | Show redacted local connection configuration. |
| `zcode_config_set` | Save a Sharing Link or clear it with `null`. |

Typical read/send flow:

~~~javascript
zcode_tasks({});
const page = zcode_read({ taskIds: [taskId] });
zcode_read({ taskIds: [taskId], cursor: page.cursor, waitMs: 30000 });
zcode_send({ requestId: "review-round-1", taskIds: [taskId],
  teamId: "review-team", prompt: "Please report current progress without changing files." });
const inbox = zcode_read({ view: "inbox", teamId: "review-team" });
zcode_read({ view: "inbox", teamId: "review-team", cursor: inbox.cursor });
~~~

These are tool-call examples, not a standalone JavaScript SDK. Task IDs must come from `zcode_tasks`; use the same filters when continuing a cursor. Up to eight tasks can be read in one call. `hasMore`, `historyGap`, `errors`, and `missing` are meaningful results, not proof that a task stopped.

Conversation reads accept up to eight tasks, 3,000 characters per task per page, and a `messageLimit` of 100 by default or 500 at most. `tailCursor` explicitly skips history. Message bodies are assembled by native message ID and `contentOffset`; `replace: true` replaces earlier text. A missing continuation anchor sets `historyGap` and does not by itself mean the task stopped.

At most four workspace snapshots run concurrently inside one workspace; workspace switches remain sequential. A single Sharing Link is still one physical connection. Teams share the same fair rotation of up to eight tasks per worker cycle and the global limit of 100 unresolved messages; a team does not receive its own concurrency pool.

Plugin processes coordinate remote access through SQLite tickets with a 30-second wait bound and crash recovery. Global pause/resume requires `scope: "all"` and the latest `worker.controlRevision` passed as `expectedRevision`; stale revisions are rejected.

### Queue and state contract

- Single and batch sends share one persistent queue. Messages for one task remain ordered; different tasks can progress independently.
- The worker starts on demand and exits when there is no work to process. A team is a grouping label, not an independent concurrency pool.
- The queue retains at most 500 complete records and keeps the total transaction storage within its bounded budget. Only confirmed terminal records may have their bodies cleaned.
- A send receipt, an observed reply, native turn completion, and business acceptance are separate states. Unknown delivery is never automatically retried.
- Explicit pause persists. Sending while paused only queues work; it does not resume the worker.
- A native stop request stops the current turn but does not cancel queued messages. Pause first when later delivery must also stop.
- The plugin does not kill processes, approve permissions, modify the ZCode database, or wake arbitrary Codex tasks.

The worker may continue an authorized, unsent head message from a native `error` or `failed` task without changing its model or message ID. Already-sent failures remain recorded and require coordinator review before release. Running, cancelled, interrupted, archived, or interaction-blocked tasks continue waiting.

For inbox retention, use a stable `consumerId` and acknowledge only after the full envelope has been read. The server rejects skipped pages and premature acknowledgements. Every registered reader must acknowledge independently before capacity cleanup; observer reads without a `consumerId` do not acquire retention rights.

## 6. Status and security boundaries

Sharing Links, pipe addresses, host bindings, receipts, and Hook samples remain in local data directories. They must not be committed, packaged, or copied into prompts. A repository clone is not a configured connection.

The Codex plugin and the ZCode bridge use different manifests and hosts. Do not merge the bridge MCP server into the Codex plugin's `.mcp.json`; install the two packages separately when two-way behavior is required.

The queue keeps at most 500 complete records. The primary database is bounded around 9 MB and begins eligible cleanup around 7 MB so journals and transaction files remain within the 20 MB total budget. If space cannot be recovered safely, enqueueing or collection stops instead of deleting unresolved data. Deduplication tombstones remain for at least seven days.

`stop_task` requests native turn cancellation only; it does not cancel the queue. Pause delivery first when later messages must not be sent. The plugin does not automatically interrupt tasks, approve permissions, modify the ZCode database, or kill processes.

## 7. Verification and maintenance

Run the Codex-side checks from the repository root:

~~~powershell
npm run smoke
~~~

Run the companion checks independently:

~~~powershell
Set-Location zcode-codex-bridge/plugin
npm test
~~~

The joint-distribution check is complete only when both suites pass. Live tests remain bounded to explicitly selected tasks; an accepted send is not by itself proof of native receipt, completion, or business acceptance.

For an explicit installed-plugin check, run `scripts/live-concurrency.mjs` only against the selected test task and a stable batch ID. It verifies same-target FIFO, duplicate request IDs, reads, and multi-reader acknowledgement, then restores the initial pause state. It does not prove that two different targets run models concurrently, and an uncertain send must not be rerun automatically.

The legacy ACP entry point remains in `scripts/legacy-gateway.mjs` for deliberate diagnosis only. It is not registered by the default plugin, and legacy cursors cannot replace `zcode_read` cursors.

## 8. Roadmap and current plans

1. Validate stronger native turn-completion correlation and reduce dependence on assistant-body presence; do not weaken completion criteria before that evidence exists.
2. Provide a standalone public marketplace installation path.
3. Continue controlling existing tasks only until an officially verifiable create-task interface exists; evaluate additional desktop agents after the current integration remains stable.

## 9. Documentation

- Queue details: [docs/message-queue.md](docs/message-queue.md)
- Native protocol notes: [docs/zcode-remote-protocol.md](docs/zcode-remote-protocol.md)
- Companion evidence: [zcode-codex-bridge/TEST-RESULTS.md](zcode-codex-bridge/TEST-RESULTS.md)
