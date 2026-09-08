# ZCode Ops

`ZCode Ops` 是一个 Codex MCP 插件，用 ZCode Desktop 的 Mobile Remote Control 工作区桥接来查看、等待、控制已有的 ZCode 对话。它面向“Codex 协助管理 ZCode 已有任务”的场景，不创建新会话。

## 1. 功能描述

- 列出 ZCode Desktop 中的真实工作区、会话和原生运行状态。
- 读取已有会话的近期消息、待处理权限、问题和命令数量。
- 等待指定会话的状态变化，适合持续跟进运行、完成、失败或等待输入。
- 读取任务可用模型；对空闲会话切换到 ZCode 当前公布的模型。
- 向用户指定的已有会话发送一条消息；请求停止指定的运行中回合。
- 管理 Sharing Link，但不会在 Codex 启动时请求或验证该链接。

远程接口的实测行为、模型恢复处理和协议边界见 [协议记录](docs/zcode-remote-protocol.md)。

## 2. 运行条件

- Windows 上已安装并打开 ZCode Desktop；当前验证版本为 ZCode `3.11.2`。
- Codex Desktop 已启用本地插件；Node.js `24` 或更高版本。
- 需要使用远程控制时，在 ZCode 左下角打开 **Mobile Remote Control** 并复制当前 Sharing Link。

Sharing Link 是当前 ZCode 窗口的访问凭据。插件将它保存在 `CODEX_HOME/zcode-ops/config.json`，安装、升级和 Git 仓库中都不保存该凭据。

## 3. 安装方法

本仓库当前通过本地 marketplace `gameops-local` 分发。已配置该 marketplace 时，在任意终端执行：

```powershell
codex plugin add zcode-ops@gameops-local
```

从源码更新插件：

```powershell
git clone https://github.com/WQMYH/Codex-with-Zcode.git
Set-Location Codex-with-Zcode
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run smoke
```

随后将本仓库登记到你的本地 marketplace，再执行上面的 `codex plugin add` 命令。仓库暂未提供独立的公开 marketplace 清单，因此 GitHub 克隆本身不是一键安装入口。

开发者更新插件后，需要更新插件缓存版本、重新安装，并重新打开一个 Codex 任务来加载新的 MCP 工具。

## 4. 首次连接与配置

第一次需要远程操作时，在 Codex 对话中提供当前 Sharing Link，调用：

```text
zcode_config_set({ sharingLink: "https://zcode.z.ai/remote/v4?..." })
```

也可使用诊断脚本：

```powershell
node scripts/remote-call.mjs zcode_config_status '{}'
node scripts/remote-call.mjs zcode_config_set '{"sharingLink":"https://zcode.z.ai/remote/v4?..."}'
```

保存时不探测链接格式或网络状态。仅在实际调用远程操作失败时，插件要求提供新的链接；不会自动重试不确定的写入操作。清除本机保存的链接：

```text
zcode_config_clear({})
```

## 5. 使用说明

常用 MCP 工具如下：

| 目标 | 工具 | 说明 |
| --- | --- | --- |
| 盘点任务 | `zcode_remote_tasks` | 返回工作区、任务、原生状态与更新时间。 |
| 阅读对话 | `zcode_remote_read` | 返回近期消息和待处理项；历史可能被 ZCode 截断。 |
| 等待变化 | `zcode_remote_wait` | 最多等待 30 秒；超时只表示状态未变。返回的 `cursor` 可传给下一次调用。 |
| 查看模型 | `zcode_remote_models` | 返回当前模型、思考等级和任务当前可选模型。 |
| 切换模型 | `zcode_remote_set_model` | 只允许空闲任务，且模型必须来自该任务实时列表。 |
| 发送消息 | `zcode_remote_send` | 只发送到指定的已有任务；确认送达不等于任务已完成。 |
| 停止回合 | `zcode_remote_cancel` | 请求 ZCode 停止指定运行回合；随后用 wait/read 确认终态。 |

诊断示例：

```powershell
node scripts/remote-call.mjs zcode_remote_tasks '{}'
node scripts/remote-call.mjs zcode_remote_read '{"taskId":"sess_...","messageLimit":20}'
node scripts/remote-call.mjs zcode_remote_wait '{"taskId":"sess_...","timeoutMs":30000}'
node scripts/remote-call.mjs zcode_remote_models '{"taskId":"sess_..."}'
node scripts/remote-call.mjs zcode_remote_set_model '{"taskId":"sess_...","model":"deepseek-v4-flash-vision-exp"}'
node scripts/remote-call.mjs zcode_remote_send '{"taskId":"sess_...","prompt":"请回传当前进展"}'
node scripts/remote-call.mjs zcode_remote_cancel '{"taskId":"sess_..."}'
```

## 6. 状态语义与边界

`running`、`completed`、`failed`、`waiting_permission` 和 `waiting_input` 来自 ZCode 的任务清单。`completed` 只表示该回合结束，不代表业务验收通过。`zcode_remote_wait` 的 `timeout` 也不代表任务中断。

模型切换、发送和停止都是需要用户授权的写操作。停止请求收到确认后仍须读取或等待任务，因为“已请求停止”不等于“已停止”。发送或停止发生超时/错误时，插件不自动重试，避免重复写入。

插件不创建新会话、不修改 ZCode 数据库、不杀死 ZCode 进程，也不自动批准 ZCode 内部的权限请求。遗留 ACP 工具仅保留诊断用途；新建、加载与发送入口仍处于暂停状态。

## 7. 验证与维护

```powershell
npm run smoke
```

`npm run smoke` 覆盖远程帧协议、模型恢复、读取、等待、停止、消息不自动重试，以及暂停的 ACP 入口。发布前还应通过 Codex 的插件校验。每次 ZCode Desktop 升级后，先对一个非关键任务运行 `zcode_remote_tasks`、`zcode_remote_models` 和 `zcode_remote_read`，确认协议没有变化。

## 8. 未来计划

1. 将独立本地 marketplace 清单随仓库发布，提供可复现的公开安装入口。
2. 评估 ZCode 的原生事件订阅；若稳定可用，再替换当前短时状态轮询。
3. 继续核验停止接口在更多 ZCode 版本和权限状态下的实际表现。
4. 在官方、可验证的桌面创建接口出现前，继续保持“仅控制已有会话”的边界。
5. ZCode 适配稳定后，评估以同一 MCP 契约接入其他桌面智能体。
