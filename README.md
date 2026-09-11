[English](README.md) | [简体中文](README.zh-CN.md)

# Codex with ZCode

**One Codex to orchestrate every agent.**

[![CI](https://github.com/WQMYH/Codex-with-Zcode/actions/workflows/ci.yml/badge.svg)](https://github.com/WQMYH/Codex-with-Zcode/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-43853D.svg)](https://nodejs.org/)

Turn Codex into the command center for your agent team: delegate work, follow progress, collect results, and decide what happens next from one conversation.

ZCode is the first integration. The long-term goal is to coordinate agents across applications through a common task-and-message workflow. **Today, this repository supports Codex ↔ ZCode; other agents are on the roadmap.**

[Features](#features) · [Installation](#installation) · [Usage](#usage) · [Roadmap](#roadmap) · [Contributing](#contributing)

## Why this project?

An agent team is more useful when its members can share work. Codex with ZCode lets Codex coordinate existing ZCode conversations using native task data and a persistent message queue—without taking over your mouse or keyboard.

Keep working on your computer while Codex checks progress, sends the next instruction, and brings the results back into your conversation. Each application keeps its own model account and execution environment.

## Features

- **See the team:** list existing tasks, workspaces, native status, and recent replies.
- **Delegate in batches:** send to 1–8 tasks per call; work on different tasks can overlap.
- **Keep work ordered:** messages to the same task share one FIFO queue, even across teams.
- **Collect results:** preserve prompts, replies, and delivery state in a bounded local inbox.
- **Choose models and intervene:** inspect advertised models, switch idle tasks, pause delivery, or request a native stop.
- **Receive a report in Codex:** the optional ZCode companion sends a fixed report to a bound Codex task.

### Current support

| Direction | Plugin | Available now |
| --- | --- | --- |
| Codex → ZCode | `zcode-ops` | Inspect, send, collect replies, select models, and control existing tasks. |
| ZCode → Codex | `zcode-codex-bridge` | Read one bound task's status and send a predefined report, including waking an unloaded task. |
| Codex → other agents | Planned | A shared coordination workflow, starting from verified host interfaces. |

The ZCode companion is optional. It does not yet support arbitrary return prompts or automatic back-and-forth execution. Neither plugin creates ZCode conversations.

## Installation

### Requirements

- **Windows**, with Codex Desktop and ZCode Desktop installed. ZCode 3.11.2 has been tested; other operating systems and host versions are not yet verified.
- **Node.js 24+** on the desktop applications' `PATH`.
- **Git** and a Codex CLI that supports `codex plugin marketplace add`.
- Access to GitHub. ZCode's **Mobile Remote Control** must be available for the connection step.

Normal installation reads this GitHub repository. You do not need to clone the source, build an archive, publish to npm, or download a GitHub Release. Both plugin entry points use Node.js built-ins; the legacy ACP dependencies are not required for normal use.

### Install in Codex

Run:

```powershell
codex plugin marketplace add WQMYH/Codex-with-Zcode
codex plugin add zcode-ops@codex-with-zcode
```

Then check that **ZCode Ops** is enabled in Codex's plugin settings.

Codex discovers the repository's [marketplace manifest](.agents/plugins/marketplace.json), which points to the plugin at the repository root. A local source path *inside a Git marketplace* does not require a manual local checkout. See the [official GitHub marketplace documentation](https://learn.chatgpt.com/docs/enterprise/plugin-management).

### Optional: install in ZCode

1. Open a workspace in ZCode.
2. Go to **Settings → Plugins → Create → Add marketplace**.
3. Enter `WQMYH/Codex-with-Zcode` or this repository's GitHub URL.
4. Install **zcode-codex-bridge** from **codex-with-zcode**.

ZCode discovers the root [marketplace.json](marketplace.json). This is a separate manifest from Codex's, in the same repository. The [official ZCode plugin guide](https://zcode.z.ai/en/docs/plugin) documents GitHub marketplace installation.

Continue with the [companion binding guide](zcode-codex-bridge/README.md#install-and-bind) to select the destination Codex task, working directory, and expiring desktop-host binding.

### Connect ZCode

1. In ZCode, open **Mobile Remote Control** and copy the current **Sharing Link**.
2. Give it to Codex and ask: “Save this connection for ZCode Ops.”
3. Ask: “List my unarchived ZCode tasks and their current status.”

The link is saved outside the checkout at `CODEX_HOME/zcode-ops/config.json`, or `~/.codex/zcode-ops/config.json` when `CODEX_HOME` is unset. There is no link prompt at Codex startup. Configuration validity is a local check, not proof that ZCode is reachable.

## Usage

Start with natural-language instructions:

> Show the ZCode tasks in this project. Ask the three tasks I select to report their progress, then collect their replies.

> Show this task's available models. When it is idle, switch it to the model I select and send my next instruction.

> Pause message delivery. Read the affected task before deciding whether to stop its current turn.

Codex uses eight tools:

| Tool | Purpose |
| --- | --- |
| `zcode_tasks` | List tasks, workspaces, and native status. |
| `zcode_read` | Read conversations or the inbox; continue or wait with a cursor. |
| `zcode_send` | Queue a prompt for one or more existing tasks. |
| `zcode_control` | Pause/resume delivery, manage receipts, or request a stop. |
| `zcode_models` | List models advertised for a task. |
| `zcode_set_model` | Select an advertised model for an idle task. |
| `zcode_config_status` | Check saved configuration without revealing the link. |
| `zcode_config_set` | Save or clear the Sharing Link. |

For automation, keep the same `requestId` when retrying the same send request. The queue worker collects replies independently of the Codex conversation; Codex retrieves them with `zcode_read`. Continuous supervision requires a separately configured scheduled task. Installation alone does not monitor every conversation.

See the [queue guide](docs/message-queue.md) for parameters, teams, cursors, acknowledgements, and recovery.

## Reliability and privacy

- **Delivery is not acceptance.** Native `completed` means a turn ended, not that its work passed review.
- **Uncertain sends are not replayed.** Inspect the conversation before recovery; never change a request ID just to resend.
- **Confirmed rate limits retry in the background.** The plugin waits at least 300 seconds between sends, with five retries per message (six attempts including the initial send). Replies and restarts do not reset the budget. All teams share a cooldown and stagger recovery sends; reads continue. Exhaustion emits `temporarily_blocked` in the inbox and blocks only that task's FIFO head. This does not wake an inactive Codex task.
- **Retry budgets belong to messages, not conversations.** Successful completion ends retries while retaining the audit count. New messages have independent budgets. External input during cooldown retires the old retry without blocking later authorized messages.
- **Read failures are isolated.** Failed batch reads get one fresh-connection check per affected task, with the original cursor and completion checks. This never retries a send.
- **Resources are bounded.** All teams share one queue and remote connection: up to 100 unresolved messages, 500 full records, and a 20 MB database-and-journal budget.
- **Pause is global.** It affects every team. Stopping one model turn does not cancel its queued follow-ups.
- **Credentials stay local.** Sharing Links, desktop-host bindings, and inbox contents can expose your tasks. Do not post them in issues, screenshots, or Git commits.

Model concurrency depends on ZCode and its provider. Remote reads and writes share a connection; this is not a promise of unlimited parallel model execution. The plugins use the target application's existing account and permissions and do not provide model credits.

This is an independent community project, not an official OpenAI or Z.ai product. Desktop interfaces can change with host updates.

## Troubleshooting

| Problem | Next step |
| --- | --- |
| Plugin cannot start | Check `node --version` is 24+ and Node is on the desktop application's `PATH`; restart the app after changing its environment. |
| Marketplace or plugin is missing | Check GitHub access and refresh the marketplace. Ensure you added the repository, not a plugin subdirectory. |
| ZCode cannot be reached | Keep ZCode and Mobile Remote Control open, check network access, and supply the current Sharing Link if necessary. |
| A message stays queued | Check pause state, pending input, and the preceding message's delivery state. |
| Native task completed but the inbox did not | Update the plugin and inspect both views. If an isolated read still fails, retain the message ID and report redacted diagnostics; do not resend. |
| Companion fails after restarting Codex | Recreate its expiring desktop-host binding. |

## Development

For local changes:

```powershell
git clone https://github.com/WQMYH/Codex-with-Zcode.git
cd Codex-with-Zcode
npm ci --ignore-scripts
npm run smoke
npm --prefix zcode-codex-bridge/plugin test
```

Both marketplaces also accept the checkout's local directory for development. Codex and ZCode cache installed plugins: refresh the source and update/reinstall the plugin after code changes. Updating Git alone does not update an already-running worker.

[CI](.github/workflows/ci.yml) runs the existing offline suites on Windows / Node.js 24 for pushes and pull requests. They use temporary data and simulated transports, without accounts, Sharing Links, or model credits. Desktop end-to-end verification is separate.

Further reading: [queue contract](docs/message-queue.md) · [protocol evidence](docs/zcode-remote-protocol.md) · [companion guide](zcode-codex-bridge/README.md) · [companion test record](zcode-codex-bridge/TEST-RESULTS.md)

## Roadmap

- [x] Coordinate existing ZCode tasks from Codex.
- [x] Persistent queues, batch dispatch, bounded retention, and completion collection.
- [x] A ZCode companion for reports to a bound Codex task.
- [ ] Richer ZCode-to-Codex messages and simpler binding.
- [ ] Event-driven notifications and more desktop compatibility checks.
- [ ] Adapters for more agents—one Codex coordinating a cross-application team.

Broader agent support is the direction, not a claim of current compatibility. Contributions that establish a working host interface are especially welcome.

## Contributing

Maintained by [WQMYH](https://github.com/WQMYH). [Issues](https://github.com/WQMYH/Codex-with-Zcode/issues) and pull requests are welcome.

For bugs, include the plugin commit, desktop versions, steps to reproduce, and redacted diagnostics. For changes, keep the scope focused and run both test suites. Do not include credentials or private conversation contents.

## License

[Apache License 2.0](LICENSE). Third-party attributions and licenses are preserved in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
