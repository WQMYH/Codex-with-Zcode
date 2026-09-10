[English](README.md) | [简体中文](README.zh-CN.md)

# Codex with ZCode

**一个 Codex，统筹所有智能体。**

[![CI](https://github.com/WQMYH/Codex-with-Zcode/actions/workflows/ci.yml/badge.svg)](https://github.com/WQMYH/Codex-with-Zcode/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-43853D.svg)](https://nodejs.org/)

让 Codex 成为你的智能体团队指挥台：在一条对话中分派工作、跟进进展、收集结果，并决定下一步。

ZCode 是首个接入对象。我们的长期目标，是用统一的任务与消息协作方式，连接不同应用中的智能体。**当前已支持 Codex ↔ ZCode，其他智能体属于后续路线图。**

[功能](#功能描述) · [安装](#安装方法) · [使用](#使用说明) · [未来计划](#未来计划) · [参与贡献](#参与贡献)

## 为什么做这个项目？

智能体之间能够交换任务与结果，才能形成协作团队。Codex with ZCode 通过原生任务数据和持久消息队列，让 Codex 协调已有的 ZCode 对话，不需要接管鼠标或键盘。

你可以继续使用电脑，让 Codex 查看进展、发送下一条指令，再把结果带回当前对话。各应用保留自己的模型账户和执行环境。

## 功能描述

- **掌握全局：**查看已有任务、工作区、原生状态和最新回复。
- **批量分派：**单次向 1–8 条任务发送指令，不同任务的工作可以重叠进行。
- **保持顺序：**同一任务共用先进先出队列，跨 team 也不会绕过顺序。
- **收集回传：**在有容量上限的本地收件箱中保留提示词、回复与投递状态。
- **选择模型与介入：**读取可用模型、为空闲任务切换模型、暂停投递或请求停止。
- **从 ZCode 回报 Codex：**可选配套插件向绑定的 Codex 任务发送固定回报。

### 当前支持范围

| 方向 | 插件 | 现有能力 |
| --- | --- | --- |
| Codex → ZCode | `zcode-ops` | 查看、发送、收集回复、选择模型和控制已有任务。 |
| ZCode → Codex | `zcode-codex-bridge` | 查看一个绑定任务的状态，发送预设回报，支持唤醒未加载的任务。 |
| Codex → 其他智能体 | 计划中 | 从经过验证的宿主接口出发，建立统一协作流程。 |

ZCode 配套插件按需安装，目前不支持任意内容回传或双方自动循环执行。两侧插件均不负责新建 ZCode 对话。

## 安装方法

### 环境要求

- **Windows**，已安装 Codex Desktop 与 ZCode Desktop。已验证 ZCode 3.11.2；其他系统与宿主版本尚未验证。
- **Node.js 24+**，桌面应用可通过 `PATH` 找到。
- **Git**，以及支持 `codex plugin marketplace add` 的 Codex CLI。
- 能访问 GitHub；连接时需要 ZCode 提供 **Mobile Remote Control** 功能。

正常安装直接读取 GitHub 仓库，不需要手动克隆源码、构建压缩包、发布到 npm 或下载 GitHub Release。两侧插件的正常入口均使用 Node.js 内置模块，不依赖旧 ACP 诊断所需的依赖包。

### 在 Codex 中安装

执行：

```powershell
codex plugin marketplace add WQMYH/Codex-with-Zcode
codex plugin add zcode-ops@codex-with-zcode
```

随后在 Codex 插件设置中确认 **ZCode Ops** 已启用。

Codex 会读取仓库中的[市场清单](.agents/plugins/marketplace.json)，定位根目录的插件。Git 市场内部的本地相对路径指向下载下来的仓库，并不要求用户手动克隆。参见[官方 GitHub 市场文档](https://learn.chatgpt.com/docs/enterprise/plugin-management)。

### 可选：在 ZCode 中安装

1. 在 ZCode 打开一个工作区。
2. 进入 **设置 → 插件 → 创建 → 添加插件市场**。
3. 输入 `WQMYH/Codex-with-Zcode`，或本仓库的 GitHub 地址。
4. 从 **codex-with-zcode** 安装 **zcode-codex-bridge**。

ZCode 读取根目录的 [marketplace.json](marketplace.json)，与 Codex 使用不同的市场清单，但二者位于同一仓库。[ZCode 官方插件指南](https://zcode.z.ai/cn/docs/plugin)说明了 GitHub 市场安装方式。

随后按照[配套插件绑定指南](zcode-codex-bridge/README.zh-CN.md#安装与绑定)，指定目标 Codex 任务、工作目录，并配置有时效的桌面宿主绑定。

### 连接 ZCode

1. 在 ZCode 打开 **Mobile Remote Control**，复制当前 **Sharing Link**。
2. 将链接交给 Codex，告诉它：“为 ZCode Ops 保存这个连接。”
3. 发送：“列出我未归档的 ZCode 任务及当前状态。”

链接保存在源码目录之外的 `CODEX_HOME/zcode-ops/config.json`；未设置 `CODEX_HOME` 时使用 `~/.codex/zcode-ops/config.json`。启动 Codex 时不会弹出链接输入窗口。配置有效仅表示本地检查通过，不代表远端可达。

## 使用说明

直接使用自然语言即可：

> 查看这个项目中的 ZCode 任务。让选中的三个任务汇报进展，然后收集它们的回复。

> 查看这条任务的可用模型，等它空闲后切换为我选定的模型，再发送下一条指令。

> 暂停消息投递。先读取受影响的任务，再决定是否停止当前回合。

Codex 通过 8 个工具完成这些操作：

| 工具 | 用途 |
| --- | --- |
| `zcode_tasks` | 列出任务、工作区和原生状态。 |
| `zcode_read` | 读取对话或收件箱，使用游标续读或等待。 |
| `zcode_send` | 向一条或多条已有任务入队发送提示词。 |
| `zcode_control` | 暂停/恢复投递、管理回执，或请求停止。 |
| `zcode_models` | 读取任务提供的模型清单。 |
| `zcode_set_model` | 为空闲任务选择清单中的模型。 |
| `zcode_config_status` | 检查已保存配置，不暴露链接。 |
| `zcode_config_set` | 保存或清除 Sharing Link。 |

自动化调用中，同一次发送重试应沿用原 `requestId`。队列后台独立采集回复，Codex 通过 `zcode_read` 读取；持续监督需要另行配置定时任务，安装本身不会监控所有对话。

参数、team、游标、接收确认和恢复方式见[队列指南](docs/message-queue.md)。

## 可靠性与隐私

- **投递不等于验收。**原生 `completed` 表示回合结束，不代表工作通过审阅。
- **未知发送不重放。**恢复前先读取对话，不要为了重发而更换请求 ID。
- **隔离读取故障。**批量读取失败时，每个受影响任务使用新连接独立核验一次，保留原游标与完成检查；绝不因此重试发送。
- **限制资源占用。**所有 team 共用一个队列和远程连接，最多 100 条未解决消息、500 条完整记录，数据库及事务日志总预算为 20 MB。
- **暂停影响全局。**暂停投递作用于所有 team；停止某个模型回合不会取消其后续排队消息。
- **凭据保留在本地。**Sharing Link、桌面宿主绑定和收件箱可能暴露任务内容，不要放入公开 Issue、截图或 Git 提交。

模型并发能力取决于 ZCode 和服务商。远程读写共用一条连接，不承诺无限并行执行。插件沿用目标应用的既有账户与权限，不提供模型额度。

这是独立社区项目，并非 OpenAI 或 Z.ai 官方产品。桌面接口可能随宿主更新而变化。

## 常见问题

| 问题 | 处理方式 |
| --- | --- |
| 插件无法启动 | 确认 `node --version` 为 24+，且桌面应用的 `PATH` 可找到 Node；更改环境后重启应用。 |
| 找不到市场或插件 | 检查 GitHub 访问并刷新市场，确认添加的是仓库地址，而非插件子目录。 |
| 无法连接 ZCode | 保持 ZCode 与 Mobile Remote Control 开启，检查网络；必要时提供当前 Sharing Link。 |
| 消息一直排队 | 检查暂停状态、待处理输入，以及前一条消息的投递状态。 |
| 原生任务完成，收件箱未完成 | 更新插件并核对两个视图；独立读取仍失败时，保留消息 ID 并提交脱敏诊断，不要重发。 |
| 重启 Codex 后配套插件失效 | 重新创建有时效的桌面宿主绑定。 |

## 开发

本地开发时执行：

```powershell
git clone https://github.com/WQMYH/Codex-with-Zcode.git
cd Codex-with-Zcode
npm ci --ignore-scripts
npm run smoke
npm --prefix zcode-codex-bridge/plugin test
```

两侧市场也都接受本地源码目录，便于开发调试。Codex 与 ZCode 会缓存已安装插件：修改后需刷新来源、更新或重装插件。只更新 Git，不会替换已运行的后台进程。

[CI](.github/workflows/ci.yml) 在 push 和 pull request 时，通过 Windows / Node.js 24 运行已有离线测试。测试使用临时数据和模拟连接，不需要账户、Sharing Link 或模型额度；桌面端到端验证另行进行。

进一步了解：[队列契约](docs/message-queue.md) · [协议证据](docs/zcode-remote-protocol.md) · [配套插件指南](zcode-codex-bridge/README.zh-CN.md) · [配套插件测试记录](zcode-codex-bridge/TEST-RESULTS.md)

## 未来计划

- [x] 从 Codex 协调已有 ZCode 任务。
- [x] 持久队列、批量派发、有界保留与完成采集。
- [x] ZCode 配套插件向绑定的 Codex 任务回报。
- [ ] 更丰富的 ZCode → Codex 消息与更简单的绑定方式。
- [ ] 事件驱动通知和更多桌面版本的兼容验证。
- [ ] 接入更多智能体，让一个 Codex 协调跨应用团队。

更多智能体支持是发展方向，不是当前兼容性承诺。尤其欢迎带来可验证宿主接口的贡献。

## 参与贡献

项目由 [WQMYH](https://github.com/WQMYH) 维护，欢迎提交 [Issue](https://github.com/WQMYH/Codex-with-Zcode/issues) 和 Pull Request。

报告问题时，请提供插件提交号、桌面版本、复现步骤及脱敏诊断。提交修改时保持范围集中，并运行两侧测试。请勿提交凭据或私密对话内容。

## 许可证

采用 [Apache License 2.0](LICENSE)。第三方来源与许可保留在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
