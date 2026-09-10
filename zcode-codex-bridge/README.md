# ZCode Codex Bridge

`zcode-codex-bridge` is a local ZCode plugin that sends one bounded, fixed report to one configured Codex desktop task. Version 0.2.4 has passed offline checks and live tests for active-task delivery, busy-task refusal, and `notLoaded` wake-up.

It is deliberately not a general Codex controller: ZCode cannot choose an arbitrary task, prompt, model, approval policy, or permission setting through this plugin.

## Supported behavior

The plugin exposes four MCP tools:

- `codex_binding_status` validates the local binding and reports its expiry, receipt counts, and metadata-only Hook summary. It does not contact Codex.
- `codex_thread_read` reads only the bound task's checked summary. It never returns task history.
- `codex_host_report` sends one immutable report through the already-running Codex desktop adapter. `requestId` is required.
- `codex_fixed_reply_test` is the retired independent-process candidate and remains blocked in production.

`codex_host_report` has two delivery modes:

- Default: send the fixed report to the bound task after a fresh identity and directory check, including when that task is active.
- `requireIdle: true`: send only when the fresh task status is `idle` or `notLoaded`. Any other status returns `not_idle` with `sent: false`; the plugin does not wait or poll.

Every request ID receives an exclusive local receipt before sending. Concurrent duplicates cannot both send. A missing acknowledgement remains `uncertain` and must not be retried under a different ID. An `accepted` receipt proves only host acceptance, not Codex completion or the requested reply.

## Safety boundary

- One configured Codex task ID and exact working directory.
- Expiring ZCode binding and expiring desktop-host binding.
- Fixed report text and fixed uppercase reply token; no arbitrary prompt parameter.
- Only the official host adapter's `read_thread` and `send_message_to_thread` tools are reachable.
- No task history is exposed to ZCode.
- No model, approval, permission, or security-setting changes.
- No automatic retries, return loops, background polling, or ZCode-session wake-up.
- The configured ZCode session and team values are provenance labels, not authenticated identities.

`host-config.json`, send receipts, the pipe address, and Hook samples belong only in the plugin data directory. Never commit or package them.

## Install

1. In ZCode, add this directory as a local marketplace:

   ```text
   <repository>/zcode-codex-bridge
   ```

2. Install `zcode-codex-bridge` from marketplace `zcode-codex-local`.
3. Configure the fields declared in `plugin/.zcode-plugin/plugin.json`:

   - `codex_script`: installed `@openai/codex/bin/codex.js`
   - `codex_thread_id`: fixed destination task ID
   - `codex_cwd`: exact destination task directory
   - `source_session_id`: ZCode provenance label
   - `team_id`: bounded team label
   - `binding_expires_at`: ISO-8601 expiry
   - `expected_reply`: uppercase fixed reply token

4. From the authorized Codex task environment, save a short-lived desktop-host binding:

   ```text
   node plugin/scripts/host-client.mjs --configure-host <plugin-data-directory> <official-app-tools-server.mjs> <ISO-expiry>
   ```

   This command requires the current Codex desktop environment and writes only `host-config.json` under the plugin data directory. It does not print the pipe address.

5. Start a new ZCode session so the installed plugin and configuration are loaded.

The host binding is coupled to the current Codex desktop process. Recreate it after a desktop restart; never guess or persist an old endpoint in the repository.

## Use

Start with `codex_binding_status`. Confirm the destination, directory, expiry, and `hostReportConfigured: true`. Use `codex_thread_read` when a fresh status is needed.

For an explicitly authorized report, call `codex_host_report` once with a new stable request ID. Add `requireIdle: true` when delivery must not occur during an active turn. Record the returned state separately from any later Codex reply:

- `accepted`, `sent: true`: the desktop host accepted the message.
- `not_idle`, `sent: false`: the target was not `idle` or `notLoaded`; nothing was sent.
- `uncertain`: dispatch may have happened; do not retry with a new ID.
- `deduplicated: true`: the same request ID returned its existing receipt.

If a coordinator relays a reply, label it as a coordinator relay. Do not present it as direct plugin delivery.

## Verification

From `plugin/`:

```text
npm test
node --check scripts/server.mjs
node --check scripts/host-client.mjs
node --check scripts/self-test.mjs
node --check hooks/probe.mjs
```

The dependency-free test covers binding validation, target and directory checks, active/busy/idle/`notLoaded` paths, request deduplication, uncertain delivery, expiry, history stripping, MCP lifecycle, Hook retention, and manifest parsing.

Live acceptance completed on 2026-09-09:

- Direct delivery to an active Codex task passed.
- One-time ZCode round-trip acknowledgement passed.
- `requireIdle: true` returned `not_idle`, `sent: false` for an active task.
- Direct `notLoaded` wake-up passed; the native Codex turn replied only with `ZCODE_CONFIRM_ONLY` and used no tools.

See [TEST-RESULTS.md](TEST-RESULTS.md) for the evidence record and [PLAN.md](PLAN.md) for design history.

## Layout

```text
marketplace.json                 ZCode local marketplace
plugin/.zcode-plugin/plugin.json
plugin/.mcp.json                 MCP server registration
plugin/scripts/server.mjs        bounded MCP surface
plugin/scripts/host-client.mjs   official desktop-adapter client
plugin/scripts/self-test.mjs     dependency-free verification
plugin/hooks/                    metadata-only lifecycle probe
plugin/skills/                   ZCode usage instructions
```
