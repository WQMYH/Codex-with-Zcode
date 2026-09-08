# ZCode Remote Protocol Evidence

Verified against the installed ZCode desktop bundle and a live Remote Control session on 2026-09-08.

- `workspace-list-response` returns the real desktop workspace and task inventory.
- `zcode-task/getTaskConfigOptions({ taskId })` returns model options independently of the conversation snapshot. Use it for discovery and switch verification because `getTaskSnapshot` can reject tasks whose saved model is no longer available.
- If the target's saved model prevents even that call, another unarchived task in the same workspace can supply the currently advertised options. The target model is reported as unavailable/unknown until `setConfigOption` succeeds and target-local verification passes.
- `setConfigOption` rejects inactive sessions. For that exact error, `resumeTask` can load the existing task with an explicitly selected advertised model and thought level; it does not send a prompt. ZCode Ops then requires target-local option verification before reporting success.
- `zcode-task/getTaskSnapshot` returns `meta.model`, `meta.thoughtLevel`, and `configOptions` when the saved model is still valid.
- The installed desktop `zcode-task` service implements `getTaskConfigOptions`, `setConfigOption`, and `setModel`. Its model branch accepts `{ taskId, traceId, configId, value }`, routes `configId: "model"` to the runtime model switch, and returns refreshed config options.
- Live model options observed: `GLM-5.3-Flash`, `GLM-5.3`, `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-vision-exp`, and `glm-5.3-flash` through the user's enabled providers.
- `setConfigOption` is allowed only after the requested value is matched against that task's freshly returned options. ZCode Ops refuses model changes while the task reports `running`, then reads a fresh snapshot to verify the new model.
- Older tasks can be slow enough for their direct `workspace-bridge-open` to be superseded. Because the bridge is workspace-scoped, ZCode Ops may attach another live task in the same workspace and still address the requested task id; it never substitutes the target task itself.
- The remote adapter still allowlists only `getTaskSnapshot`, `getTaskConfigOptions`, `resumeTask`, `sendPrompt`, and `setConfigOption`; task creation and arbitrary service dispatch remain blocked.
- Sharing links are stored without format probing. URL parsing and required authentication fields are checked only when a remote operation is attempted. A connection failure asks for a new link; no automatic send retry occurs.
- Codex startup performs no ZCode operation and shows no link prompt. OpenAI's optional plugin components currently run through the ChatGPT MCP Apps UI path, so this local Codex plugin uses the native conversation input instead of a separate imitation window: <https://developers.openai.com/plugins/build/chatgpt-ui>.

The desktop bundle is implementation evidence, not a stable public contract. Re-run the live snapshot and switch verification after ZCode upgrades.
