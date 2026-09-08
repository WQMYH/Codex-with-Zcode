# ZCode Remote Protocol Evidence

Verified against the installed ZCode desktop bundle and a live Remote Control session on 2026-09-08.

- `workspace-list-response` returns the real desktop workspace and task inventory.
- `zcode-task/getTaskConfigOptions({ taskId })` returns model options independently of the conversation snapshot. Use it for discovery and switch verification because `getTaskSnapshot` can reject tasks whose saved model is no longer available.
- If the target's saved model prevents even that call, another unarchived task in the same workspace can supply the currently advertised options. The target model is reported as unavailable/unknown until `setConfigOption` succeeds and target-local verification passes.
- `setConfigOption` rejects inactive sessions. For that exact error, `resumeTask` can load the existing task with an explicitly selected advertised model and thought level; it does not send a prompt. ZCode Ops then requires target-local option verification before reporting success.
- `zcode-task/getTaskSnapshot` with `clientMode: "web-remote-replayable"` normally calls `resolveTaskIndexResumeHints` before reading, which can reapply an unavailable historical model even after a successful runtime switch. Passing `resumeModelPolicy: "ui-resolved-only"` skips that index-hint step. Live verification on 2026-09-08 recovered the requested task's user prompt and assistant progress through the remote API, without a model change or prompt side effect.
- The installed desktop `zcode-task` service implements `getTaskConfigOptions`, `setConfigOption`, and `setModel`. Its model branch accepts `{ taskId, traceId, configId, value }`, routes `configId: "model"` to the runtime model switch, and returns refreshed config options.
- Live model options observed: `GLM-5.3-Flash`, `GLM-5.3`, `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`, and `glm-5.3-flash` through the user's enabled providers.
- `setConfigOption` is allowed only after matching a freshly advertised option (target first, with the same-workspace recovery described above). ZCode Ops refuses model changes while the task reports `running`, then calls target-local `getTaskConfigOptions` to verify the new model.
- Older tasks can be slow enough for their direct `workspace-bridge-open` to be superseded. Because the bridge is workspace-scoped, ZCode Ops may attach another live task in the same workspace and still address the requested task id; it never substitutes the target task itself.
- `zcode-task/stopGeneration({ taskId, workspacePath, workspaceIdentity? })` sends a native V4 conversation `stop` command. It is task-scoped, not conditional on an expected run ID. ZCode Ops rechecks native running status immediately before this call; ACK is reported only as `cancel_requested`. Fake-transport and tool regressions cover targeting, ended turns and uncertain delivery; no live business task was stopped for validation.
- `zcode_remote_wait` polls native workspace-list status with a bounded 0–30 second wait window plus request latency. The cursor includes task/workspace/native status/archive state, excluding timestamps and text. Connections are released between polls. Live verification returned `running` with `timedOut: true`, without inferring interruption; deterministic tests cover transitions, attention, missing tasks and transport failure.
- The remote adapter allowlists only `getTaskSnapshot`, `getTaskConfigOptions`, `resumeTask`, `sendPrompt`, `setConfigOption`, and `stopGeneration`; task creation and arbitrary service dispatch remain blocked.
- Sharing links are stored without format probing. URL parsing and required authentication fields are checked only when a remote operation is attempted. A connection failure asks for a new link; no automatic send retry occurs.
- Codex startup performs no ZCode operation and shows no link prompt. OpenAI's optional plugin components currently run through the ChatGPT MCP Apps UI path, so this local Codex plugin uses the native conversation input instead of a separate imitation window: <https://developers.openai.com/plugins/build/chatgpt-ui>.

## Large snapshot repair (2026-09-09)

`Invalid remote frame` on long conversations was a receiver-limit bug, not evidence
of an expired Sharing Link. A live response declared 2,395,800 bytes in four
fragments; its first base64 fragment was 1,048,236 characters (786,177 decoded
bytes). The receiver incorrectly treated our outgoing 512 KiB fragment size as
the peer's receive limit. Reading two messages succeeded with the same link.

The receiver now accepts base64 fragments up to 1 MiB (768 KiB decoded), while
the physical JSON envelope still must fit 1 MiB. The 16 MiB assembled-message
cap, fragment-count/in-flight limits, canonical base64, size and CRC32 checks
remain enforced. Outgoing fragmentation stays at 512 KiB. Synthetic regression
coverage reproduces the observed four-fragment shape through receive/decode,
including reversed arrival order, acknowledgment and oversize rejection.

Live default-limit reads subsequently recovered 100 messages from task 1 and
21 messages from task 3. Task 1's text output was capped at 24,000 characters;
successful transport does not imply complete history or review acceptance.

Operational lessons: match exact task IDs (titles `1` and `01` are distinct);
inspect all monitored tasks each pass; serialize only short remote calls, never
wait for one task's completion before checking others. Native `completed` means
a turn ended, not that the overall task or review passed. Check messages and
authoritative evidence before advancing. Never retry an uncertain send/stop;
inspect delivery first. Diagnose transport fields before requesting a new link,
and never record link secrets or conversation bodies in diagnostics.

The previous eight-task review monitor was retired at the user's request. Its
two-round review gate is no longer a prerequisite for the Bio-Harness handoff.

The desktop bundle is implementation evidence, not a stable public contract. Re-run the live snapshot and switch verification after ZCode upgrades.
