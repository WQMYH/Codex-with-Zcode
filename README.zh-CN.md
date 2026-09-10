[EN](README.md) | [中文](README.zh-CN.md)

# ZCode Ops

ZCode Ops 是 Codex 侧 MCP 插件，用于查看已有的 ZCode Desktop 任务、发送经授权的消息、读取回传并管理持久投递队列。它不会打开新的桌面窗口，也不会创建新任务。

## 1. 功能描述

本仓库共同分发两个方向相反、彼此独立的插件：

- 根目录的 `zcode-ops` 运行在 Codex 中，通过 Mobile Remote Control 读取、排队和控制已有的 ZCode Desktop 任务。
- [`zcode-codex-bridge/`](zcode-codex-bridge/README.zh-CN.md) 运行在 ZCode 中，通过本机官方适配器向一个已绑定的 Codex Desktop 任务发送一次受限固定回报。

两者使用不同宿主和清单。只有需要双向协同时才分别安装两个插件。

## 2. 运行条件

- Windows
- 已启用 Mobile Remote Control 的 ZCode Desktop（实测 3.11.2）
- 支持本地插件的 Codex Desktop
- Node.js 24 或更高版本

Sharing Link 是访问凭据，只保存在本机 `CODEX_HOME/zcode-ops/config.json`，不得进入仓库或安装包。

## 3. 安装方法

### Codex 插件

已配置本地 marketplace `gameops-local` 时：

~~~powershell
codex plugin add zcode-ops@gameops-local
~~~

源码检查：

~~~powershell
git clone https://github.com/WQMYH/Codex-with-Zcode.git
Set-Location Codex-with-Zcode
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run smoke
~~~

克隆只取得源码，不等于完成安装。还需将仓库登记到 Codex 实际使用的本地 marketplace，再安装插件；本仓库目前没有一键公开 marketplace。

本地安装更新时，应刷新插件缓存版本，并从实际提供该插件的 marketplace 重新安装。测试前先确认当前加载的工具版本；“已安装的副本”和“当前正在运行的 MCP 进程”是不同状态。

### ZCode 配套插件

在 ZCode 中把以下子目录添加为本地 marketplace，再从 `zcode-codex-local` 安装 `zcode-codex-bridge`：

~~~text
<repository>/zcode-codex-bridge
~~~

其临时 Codex 绑定、固定回报契约、`requireIdle` 模式和实机证据见 [Bridge 中文说明](zcode-codex-bridge/README.zh-CN.md)，独立检查记录见 [TEST-RESULTS.md](zcode-codex-bridge/TEST-RESULTS.md)。

## 4. 连接与配置

任务需要远程连接时，通过 ZCode Ops 工具保存当前 Sharing Link：

~~~javascript
zcode_config_set({ sharingLink: "https://zcode.z.ai/remote/v4?..." });
zcode_config_status({});
// 明确清除本机凭据：
zcode_config_set({ sharingLink: null });
~~~

保存链接时不会预先探测连接；后续操作确实连接失败时再更新。安装和启动不会自动索取凭据。

## 5. 使用说明

默认入口提供 8 个工具：

| 工具 | 用途 |
| --- | --- |
| `zcode_tasks` | 列出真实任务、工作区和原生状态。 |
| `zcode_read` | 读取一条或多条对话，或读取持久收件箱；支持游标续读和有限等待。 |
| `zcode_send` | 向 1–8 个指定任务入队并返回持久回执。 |
| `zcode_control` | 暂停或恢复投递、取消未发消息、释放阻塞项，或请求原生停止。 |
| `zcode_models` | 读取任务公开的模型清单。 |
| `zcode_set_model` | 为指定空闲任务选择其清单中的模型。 |
| `zcode_config_status` | 查看脱敏的本地连接配置。 |
| `zcode_config_set` | 保存 Sharing Link，或用 `null` 清除。 |

典型读取和发送流程：

~~~javascript
zcode_tasks({});
const page = zcode_read({ taskIds: [taskId] });
zcode_read({ taskIds: [taskId], cursor: page.cursor, waitMs: 30000 });
zcode_send({ requestId: "review-round-1", taskIds: [taskId],
  teamId: "review-team", prompt: "请回传当前进展，不修改文件。" });
const inbox = zcode_read({ view: "inbox", teamId: "review-team" });
zcode_read({ view: "inbox", teamId: "review-team", cursor: inbox.cursor });
~~~

这些是工具调用示例，不是独立 JavaScript SDK。任务 ID 必须来自 `zcode_tasks`；续读游标时必须保持相同过滤器。一次最多读取 8 个任务。`hasMore`、`historyGap`、`errors` 和 `missing` 都是有效结果，不能据此直接断言任务已停止。

对话读取每任务每页最多 3,000 个字符，`messageLimit` 默认 100、最大 500。`tailCursor` 明确跳过历史。正文按原生消息 ID 和 `contentOffset` 拼接；`replace: true` 会替换旧正文。续读锚点缺失时返回 `historyGap`，这本身不表示任务中断。

同一工作区最多并发取得 4 个快照，跨工作区依次切换；一个 Sharing Link 仍然只有一个物理连接。多个 team 共用每轮最多 8 个任务的公平轮转和全局 100 条未解决消息上限，team 不拥有单独的并发池。

多个插件进程通过 SQLite 票据协调远程访问，等待上限 30 秒，并支持崩溃回收。全局 pause/resume 必须传 `scope: "all"`，并把最新的 `worker.controlRevision` 作为 `expectedRevision` 传入；过期 revision 会被拒绝。

### 队列与状态契约

- 单条和批量发送共用一个持久队列。同一任务保持顺序，不同任务可独立推进。
- worker 按需启动，无可处理工作时退出；team 只是分组标签，不是独立并发池。
- 队列最多保留 500 条完整记录，并限制事务存储总量；只有已确认的终态记录才允许清理正文。
- 发送回执、观察到回复、原生回合完成和业务验收是不同状态。未知投递不会自动重试。
- 显式暂停会持久保留；暂停时发送只会入队，不会自动恢复 worker。
- 原生停止请求只停止当前回合，不取消队列；若后续消息也不能投递，应先暂停。
- 插件不会杀进程、批准权限、修改 ZCode 数据库，也不会唤醒任意 Codex 任务。

已授权且尚未发送的队首消息，可以从原生 `error` 或 `failed` 状态继续，不改变模型或消息 ID。已经发送但失败的消息保留记录，必须由协调者核实后再释放。运行中、已取消、已中断、已归档或等待交互的任务继续等待。

需要收件箱保留保护时，使用稳定的 `consumerId`，并在完整读取 envelope 后再确认。服务端会拒绝跳页和提前确认；所有已登记读取者都确认后才允许容量清理。未传 `consumerId` 的旁观读取不取得保留权。

## 6. 状态与安全边界

Sharing Link、管道地址、宿主绑定、回执和 Hook 样本只保存在本机数据目录，不得提交、打包或复制到提示词中。克隆仓库不等于已经配置连接。

Codex 插件和 ZCode Bridge 使用不同清单及宿主。不要把 Bridge MCP 服务并入 Codex 插件的 `.mcp.json`；需要双向能力时分别安装。

队列最多保留 500 条完整记录。主数据库约 9 MB 上限，并在约 7 MB 时开始清理符合条件的内容，为日志和事务文件保留空间，使总预算不超过 20 MB。无法安全回收空间时，系统会拒绝入队或暂停采集，而不会删除未解决数据。去重残留记录至少保留 7 天。

`stop_task` 只请求取消原生回合，不取消队列；若后续消息也不能发送，应先暂停投递。插件不会自动打断任务、批准权限、修改 ZCode 数据库或杀进程。

## 7. 验证与维护

在仓库根目录运行 Codex 侧检查：

~~~powershell
npm run smoke
~~~

独立运行 Bridge 检查：

~~~powershell
Set-Location zcode-codex-bridge/plugin
npm test
~~~

两个测试集都通过，才算共同分发检查完成。实机测试只限明确选择的任务；发送被接受不等于原生已收到、已经完成或通过业务验收。

需要显式检查已安装插件时，只能针对选定测试任务和稳定批次 ID 运行 `scripts/live-concurrency.mjs`。它会检查同目标 FIFO、重复 request ID、读取和多读取者确认，并在结束后恢复最初的暂停状态。它不证明两个不同目标在同时运行模型；未知发送不得自动重跑。

旧 ACP 入口保留在 `scripts/legacy-gateway.mjs`，仅供主动诊断，不在默认插件中注册。旧游标不能替代 `zcode_read` 游标。

## 8. 路线图与当前计划

1. 验证更可靠的原生回合结束关联，减少对助手正文存在的依赖；取得证据前不降低完成判据。
2. 提供独立的公开 marketplace 安装入口。
3. 官方可验证的新建任务接口出现前，仅控制已有任务；当前集成稳定后再评估其他桌面智能体。

## 9. 文档

- 队列说明：[docs/message-queue.md](docs/message-queue.md)
- 原生协议记录：[docs/zcode-remote-protocol.md](docs/zcode-remote-protocol.md)
- Bridge 实机证据：[zcode-codex-bridge/TEST-RESULTS.md](zcode-codex-bridge/TEST-RESULTS.md)
