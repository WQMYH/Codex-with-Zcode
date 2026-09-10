# Candidate test results

## 0.2.4 notLoaded wake — PASS

The user-authorized confirmation-only target was Codex task `01a06f67-c2c5-74b3-bcef-befc3d7265a0`, title `文件体系整理`, cwd `E:/Programming/AI/Agents/Documents`. A read through the same official desktop adapter reported `status.type:notLoaded` before dispatch. This target replaced the continuously active receiver only for the explicitly authorized confirmation-only fallback; no business work was requested.

Version 0.2.4 treats only `idle` and `notLoaded` as eligible for `requireIdle:true`; `active` and every other/unknown state still return `not_idle, sent:false`. Its immutable report now asks only for `ZCODE_CONFIRM_ONLY` and forbids tools, starting or continuing work, file/config changes, and automatic return loops. Independent reviewer `review_idle_gate` found no blocking issue before testing. `npm test`, syntax checks, JSON parsing and version checks passed. Native plugin management installed/enabled 0.2.4 at `2026-09-09T16:50:38.054Z`, diagnostics empty; installed source, adapter, tests, skill, manifest and package files matched the candidate byte-for-byte.

The ZCode source task `sess_3ae1dfd5-77be-4e4a-8419-ed5981aa7d0e` invoked exactly one `codex_host_report` with request `zcc_notloaded_wake_20260910_01` and `requireIdle:true`. Its durable receipt records `targetStatusBeforeSend:{type:notLoaded}`, `state:accepted`, `sent:true`, `deduplicated:false`, and the exact destination task ID. ZCode then completed natively; no retry or alternate ID was used.

The destination rollout records the native incoming delegation at `2026-09-09T16:53:41.362Z`, turn `01a08716-c60e-7a43-84eb-b77d6e2d8960`, followed by the sole assistant answer `ZCODE_CONFIRM_ONLY` and `task_complete` at `16:53:45.655Z`. The turn contains no command execution, file change, or model tool call. This is installed-plugin direct delivery from a `notLoaded` Codex task to a completed native turn. It is not a coordinator relay; host acceptance and native completion are recorded separately.

## Historical 0.2.1 idle-wake result — NOT PASSED

This section is retained as the failed self-wait record and is superseded by the verified 0.2.4 `notLoaded` wake above.

Probe source `sess_f5dc147b-b920-4c44-b1c6-47372ab6964f`, title `ZCode Codex Bridge 0.2.1 空闲唤醒一次性验收`, completed without retry. Native report `msg_mtu9kgbd_9f05f931-529c-443c-8634-fc4a6664e396` was fully read at `2026-09-09T15:40:47.711Z`, with `completionConfirmed:true` and no pending interactions. Binding passed; `codex_host_report` returned `Desktop host request failed`. There is no `host-report-zcc_host_idle_20260909_01.json` dispatch receipt.

Read-only diagnosis through the same official adapter confirmed the native tool is advertised, but a zero-timeout `wait_threads` call for the bound/calling task returned `isError:true`, exact message `wait_threads cannot wait on the calling thread.` Version 0.2.1 invokes this before creating its dispatch receipt or calling send, consistent with the observed preflight failure. No message was retried and no calling identity was substituted.

The receiver's final response was immediately followed by an automatic active-goal continuation. This prevents assuming a controlled idle window. Goal pause is user-controlled; the agent must not fake goal completion to stop the scheduler. The next real idle-wake test needs that external state change, not another generic sending authorization.

0.2.2 corrects the implementation by removing the unsupported native wait and rejecting the retired argument. Optional `requireIdle:true` performs only a fresh read, returns `not_idle/sent:false` while busy, and preserves earlier accepted/uncertain receipts. Independent reviewer `review_host_adapter` cleared the code for offline testing and requested the packaged skill wording be updated; that wording was corrected and read back before installation. `npm test` and both server/adapter syntax checks passed. Native management installed/enabled 0.2.2 at `2026-09-09T15:45:49.944Z`, diagnostics empty. Installed server, adapter, skill and manifest were compared byte-for-byte to source and matched. No new real report was sent and no idle-wake PASS is claimed.

Next controlled test: user pauses the receiver's continuous goal; a fresh ZCode session loads 0.2.2 and invokes one explicitly assigned `codex_host_report` with `requireIdle:true` after the receiver ends its setup turn. Verify its `targetStatusBeforeSend:idle`, native incoming turn and source completion; do not use a competing automatic-goal continuation as wake evidence. The failed 0.2.1 probe is terminal, not a running wait. No automatic retransmission is pending.

## 0.2.0 current result — direct desktop delivery RECEIVED

Independent reviewer `review_host_adapter` found two issues (reply token missing from receipt identity; ambiguous live-send flag). Both were fixed and the reviewer explicitly cleared the candidate for tests. `npm test` and syntax checks then passed, including concurrent same-ID calls, lost acknowledgements/no retry, changed token/source conflicts, wrong target, expiration and history stripping.

Read-only discovery reused the installed official `codex-app-tools/0.1.3/server.mjs` through its inherited local named-pipe configuration. It listed native `read_thread`/`send_message_to_thread` and returned the exact current desktop target/cwd. The pipe address stays only in local plugin data. No independent Codex App Server was launched.

The existing ZCode Protocol management API refreshed only `zcode-codex-local`, then updated only `zcode-codex-bridge@zcode-codex-local` at `2026-09-09T15:25:09.295Z`: installed/enabled 0.2.0, diagnostics empty. ZCode's protocol is NDJSON without a `jsonrpc` field; an initial invalid-message diagnostic was read-only. No GUI installation, host restart, security setting or source queue control was needed for this update.

New native ZCode session: `sess_3ae1dfd5-77be-4e4a-8419-ed5981aa7d0e`, title `ZCode Codex Bridge 0.2.0 桌面直推验收测试`. Original model/effort retained. Its completed native assistant report is `msg_mtu97znt_ea433aa4-d3af-4429-80dd-cb012d8bad39`; full read reached `hasMore:false`, `completionConfirmed:true`, no pending permissions/questions/commands. It reports the two requested plugin calls only.

`codex_host_report` receipt `zcc_host_direct_20260909_01`: created `15:29:54.007Z`, accepted `15:29:54.155Z`, `sent:true`, target `01a08655-02a0-72b2-9f63-742ed5fe6caa`. Local receipt: `C:/Users/WQ/.zcode/cli/plugins/data/zcode-codex-bridge@zcode-codex-local/host-report-zcc_host_direct_20260909_01.json`. Configured source label remains the preceding test-chain session; the actual calling session is recorded separately above, not asserted as transport-authenticated.

The native incoming `[ZCode 插件直推测试 / zcc_host_direct_20260909_01]` message interrupted the receiver's `clock.sleep`; the receiver acknowledged `ZCODE_CODEX_RETURN_OK`. This is direct installed-plugin delivery, not a coordinator relay or file-mailbox substitute. The receiver was still in an active turn: it proves asynchronous event delivery during a wait, not idle-to-running wake. P3 idle wake remains unverified.

Hook events for the new source: SessionStart `15:29:31.458Z`, UserPromptSubmit `15:29:32.262Z`, Stop `15:30:15.471Z`. No commit/push, source-plugin edits or queue resume was performed.

## Historical 0.1.0 results

0.2.0 roundtrip acknowledgement also completed: queue message `f99ffc02-e2e9-476c-a981-7ab9ebe5525e`, request `zcc_host_direct_ack_20260909_01`, native assistant `msg_mtu9fk36_f875a1af-c6b7-4020-bf82-b031d3c9715e` returned `ZCODE_ROUNDTRIP_ACK_RECORDED`; inbox events 55–63 end in native/delivery `completed`. This acknowledgement was explicitly sent once through the existing queue, not an automatic reply loop.

0.2.1 idle-wake increment passed independent review after moving receipt lookup before native waiting (so `not_idle` cannot mask an earlier accepted/uncertain send). Deterministic tests cover busy/no-send, idle/accepted, repeated accepted receipt while now busy, and delivery-mode conflicts. `npm test` and syntax checks passed before installation. Native plugin management installed/enabled 0.2.1 at `2026-09-09T15:37:13.415Z`, diagnostics empty. One new desktop probe is being staged with request `zcc_host_idle_20260909_01`, `waitForIdle:true`; its result is pending. The receiver must finish its current turn for this test to observe idle. Do not infer success from staging or retry this probe blindly.

Recorded: 2026-09-09. Candidate: `zcode-codex-bridge` 0.1.0.

## Independent review

Reviewer `review_zcode_bridge` reviewed the implementation and the added in-memory transport tests without editing files or running tests. Final conclusion: no blocking findings; proceed to offline testing only.

The reviewer withdrew an event-envelope finding after checking the versioned official protocol types. Codex `rust-v0.153.4` defines [TurnCompletedNotification](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/TurnCompletedNotification.ts) with `threadId` and `turn`, and [ItemCompletedNotification](https://raw.githubusercontent.com/openai/codex/rust-v0.153.4/codex-rs/app-server-protocol/schema/typescript/v2/ItemCompletedNotification.ts) with `item`, `threadId`, `turnId` and `completedAtMs`. The client retains task/turn attribution checks. Test messages contain the subset consumed by the client; they are not full schema validation.

## Offline test — PASS

After the final review, `npm test` in `plugin/` exited 0. The dependency-free check covers:

- Production send lock before configuration, process or ledger access; exported send requires an injected transport.
- JSONL initialization and summary read without resume or generation.
- Candidate fixed-reply attribution, native IDs, wrong-turn exclusion and non-passive item detection.
- Expired binding, busy task, cwd mismatch, failed completion, disconnect and timeout handling.
- Request receipt deduplication, changed-binding conflict and no automatic uncertain-send retry.
- MCP initialization/version negotiation, notification non-execution and invalid params.
- Metadata-only Hook retention capped at 200 entries; plugin/MCP/Hook/marketplace JSON parsing.

`node --check` passed for `server.mjs`, `self-test.mjs` and `probe.mjs`. These tests used memory streams and disposable temporary files only; no Codex process, model, service or real task was invoked. Temporary test files were removed by the self-check.

## Installation and real-session check — PASS; direct push — BLOCKED

On 2026-09-09 the user approved continuing installation and real sending to the current Codex task, `01a08655-02a0-72b2-9f63-742ed5fe6caa`. This supersedes the earlier target and pending user-send approval; it does not supply a desktop-host endpoint.

- ZCode UI and `plugins list` confirmed version 0.1.0 installed and enabled. The installation registry records `2026-09-09T14:46:41.401Z`; the operator who clicked Install was not observed by this agent.
- Initially the CLI listed `mcp: none`. The local runtime resolves required `${user_config.*}` fields from `plugins.options[pluginId]`; those options were absent. Only this plugin's options were added to `C:/Users/WQ/.zcode/cli/config.json`, preserving other settings. The next listing resolved `plugin:zcode-codex-bridge:codex-bridge`.
- The fixed recipient is the current Codex task and cwd `E:/Programming/IDE/.codex/worktrees/fc8a/Codex`, expiry `2026-09-09T16:30:00Z`. The ZCode sender's different cwd is expected; these are two different tasks. After the test, the saved source provenance label was updated to the observed test session ID for future runtime loads; no authenticated sender identity is claimed.
- A new ZCode desktop test session, `sess_a0745502-de23-4531-8a25-800ab77d6493`, title `ZCode Codex Bridge 插件安装验收测试`, used the existing GLM-5.3-Flash / highest setting. No model or permission setting was changed.
- Its native report `msg_mtu82vtp_9bb3c1bc-a726-44a0-beec-e51b2edc6d4b` reports one successful `codex_binding_status` call with the current target ID, then one `codex_fixed_reply_test` call (`requestId=zcc-current-thread-20260909-01`) returning `state=blocked`, `sent=false`. The latter is the candidate's code lock, not a new host-policy denial. The error text still mentions a permission decision; the user has now authorized sending, while the required host adapter remains absent.
- The plugin's actual metadata file records this session's `SessionStart` at 14:57:33.007Z, `UserPromptSubmit` at 14:57:34.277Z and `Stop` at 14:58:27.562Z. The native session completed; no direct-send receipt or Codex generation was produced.

## Real report relay to the current task — RECEIVED

The coordinator read the completed ZCode report through `zcode_read`, then made one authorized `send_message_to_thread` call addressed to `01a08655-02a0-72b2-9f63-742ed5fe6caa`. The app accepted it and delivered the labeled relay message into this running task. The receiving coordinator observed the incoming message and did not resend it.

This proves a coordinator-mediated report relay using existing host tools. It does **not** prove that the new ZCode plugin directly pushes to, wakes, or controls the running Codex desktop task. No independent Codex CLI was launched and no file-mailbox substitute was used. Direct push remains the outstanding implementation gap, not a request for another send authorization.

## Earlier live status (historical)

First GUI check on 2026-09-09: with the user's approval to enter installation checks, the local marketplace directory was added through ZCode's plugin-market UI. ZCode displayed `zcode-codex-local` and the `ZCode Codex Bridge` candidate with an Install button. Marketplace discovery passed; installation has not occurred. Windows Computer Use requires action-time confirmation before clicking Install, so execution paused at that button. Binding and live Hook checks remain pending.

- Two earlier read-only App Server launch diagnostics were rejected before execution with `blocked by policy`; no detailed reason was returned. They were not retried in this continuation.
- No first ZCode GUI installation, new ZCode test session, live Hook observation, native reply or desktop visibility result exists.
- Production sending remains disabled with no configuration unlock. The candidate independent-process adapter does not prove desktop-host ownership; its permission overrides can persist and cannot prevent every tool call.
- The existing source plugin and historical queue were not changed or resumed. No commit or push was made.

The first-install and new-session steps above have since completed. The original independent-process send candidate remains locked; an actual desktop-host delivery adapter is required before direct-push acceptance.
