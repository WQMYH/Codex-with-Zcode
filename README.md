# ZCode Ops

通过 ZCode Desktop 的 Mobile Remote Control，在 Codex 中查看已有任务、发送消息并读取回传的 MCP 插件。不占用桌面，不创建新会话。

## 1. 功能描述

- 盘点真实工作区、任务及原生状态；批量续读对话、短时等待变化。
- 单条与批量消息共用持久队列：同任务按顺序发送，不同任务不等待彼此的模型回复。
- 后台按需启动、采集回传，无可处理消息时退出；队伍只是汇总标签。
- 最多 500 条完整往返记录、20 MB 含事务文件的磁盘预算；仅自动清理已确认接收的终态记录正文。
- 查看可用模型、切换空闲任务模型、请求停止运行回合。
- 在对话中管理 Sharing Link；启动 Codex 不弹窗、不自动连接。

## 2. 运行条件

Windows、已打开的 ZCode Desktop（实测 3.11.2）、支持本地插件的 Codex Desktop、Node.js 24 或更高版本。
使用时打开 ZCode 的 **Mobile Remote Control**，复制当前 Sharing Link。它是访问凭据，仅保存在本机 `CODEX_HOME/zcode-ops/config.json`，不进仓库或安装包。

## 3. 安装方法

已配置本地 marketplace `gameops-local` 时：

```powershell
codex plugin add zcode-ops@gameops-local
```

源码检查：

```powershell
git clone https://github.com/WQMYH/Codex-with-Zcode.git
Set-Location Codex-with-Zcode
npm ci --ignore-scripts --registry=https://registry.npmjs.org
npm run smoke
```

源码使用者还需将仓库登记到自己的本地 marketplace，再安装插件。当前没有随仓库分发的独立公开 marketplace；克隆不等于安装。
开发更新需要刷新插件缓存版本并重新安装，但不必一律重开 Codex 任务。先核对实际调用的工具版本；如果当前内置入口仍连接旧进程，可在同一任务内用已安装目录的 `scripts/remote-call.mjs` 启动新版 MCP。原地刷新或新开任务是另一种加载方式，不能把“已安装”直接当作“当前入口已更新”。

## 4. 连接与配置

在需要使用时把当前链接交给 Codex：

```javascript
zcode_config_set({ sharingLink: "https://zcode.z.ai/remote/v4?..." });
zcode_config_status({});
// 明确清除本机凭据：
zcode_config_set({ sharingLink: null });
```

保存时不预先探测链接或网络；实际连接失败再更新链接。安装和启动不主动索取凭据。

## 5. 使用说明

默认只提供 8 个工具，日常使用前三个：

| 工具 | 用途 |
| --- | --- |
| `zcode_tasks` | 列出真实任务、工作区和状态。 |
| `zcode_read` | 读取一条或多条对话，或读取持久收件箱；同一入口支持续读与等待。 |
| `zcode_send` | 向 1–8 个指定任务入队，返回回执；未暂停时按需启动后台。 |
| `zcode_control` | 暂停/恢复队列、取消未发消息、人工释放阻塞项、请求停止原生回合。 |
| `zcode_models` | 查看任务实时可用模型。 |
| `zcode_set_model` | 为指定空闲任务选择其清单中的模型。 |
| `zcode_config_status` | 查看脱敏连接配置。 |
| `zcode_config_set` | 保存链接，或用 null 清除。 |

下面的 taskIds 必须替换为任务清单中的真实 ID，并使用用户指定的收件人：

```javascript
zcode_tasks({});
const page = zcode_read({ taskIds: [taskId] });
// 保持相同过滤器；等待最多 30 秒，另加请求延迟。
zcode_read({ taskIds: [taskId], cursor: page.cursor, waitMs: 30000 });
zcode_send({ requestId: "review-round-1", taskIds: [taskId],
  teamId: "review-team", prompt: "请回传当前进展，不修改文件。" });
const inbox = zcode_read({ view: "inbox", teamId: "review-team" });
zcode_read({ view: "inbox", teamId: "review-team", cursor: inbox.cursor });
```

示例表示工具调用及其返回值，不是独立 JavaScript SDK。诊断时也可运行：

```powershell
node scripts/remote-call.mjs zcode_tasks '{}'
node scripts/remote-call.mjs zcode_control '{"action":"pause","scope":"all","expectedRevision":0}'
```

对话支持一次最多 8 个任务、每任务每页 3,000 字符、messageLimit 默认 100/最大 500。`hasMore` 表示继续读；`tailCursor` 明确跳过历史；`errors`/`missing` 保留单项失败。游标绑定视图与过滤器，不要改写。正文按原生消息 ID、`contentOffset` 拼接，`replace: true` 时替换旧正文。`historyGap` 表示续读锚点缺失，不等于任务中断。

同工作区最多 4 个快照并发，跨工作区依次切换；单 Sharing Link 仍只有一个物理连接。不要逐条等待模型完成才查看下一任务。
team 没有独立并发名额：多个 team 共用每轮 8 个任务的公平轮转，全局最多 100 条待解决消息。发送请求顺序进行，ZCode 模型回合可以重叠；模型并发由 ZCode/供应商决定。
多个插件进程通过 SQLite 顺序票据协调连接，等候上限 30 秒；仅持有者可以访问远端，崩溃后回收票据。pause/resume 明确影响所有 team，必须传 `scope:"all"` 和最新 `worker.controlRevision` 作为 `expectedRevision`；示例中的 0 不能直接复用，先读取当前收件箱。过期控制拒绝执行。

## 6. 状态与安全边界

`zcode_send` 返回持久化回执，不等待模型回复。后台只采集队列消息的结果；不会自动监控所有任务，也不会唤醒 Codex。读取收件箱、判断结果和下一步仍由 Codex 工具调用完成。

显式暂停会持久保留，后续发送只入队、不解除暂停；用 `zcode_control({ action: "resume" })` 恢复。旧数据库升级时，原来的停止状态迁移为暂停，消息和事件保留。

发送获确认、观察到回复、原生回合结束和业务验收是不同状态。当前队列仍要求关联的助手正文已读完且原生回合结束，才放行同任务下一条；不把旧 completed、空回复或超时当作完成。未知发送不自动重发。

失败态接续：已授权且尚未发送的队首消息可直接接续原生 `error/failed` 对话，沿用原模型和原消息 ID；无人值守无需再确认恢复。原生 `sendPrompt → sendText` 发起新回合，无需重置成 idle 或重启 ZCode。已发送失败的消息仍保留结果；协调者核实后释放阻塞，再安排恢复消息。运行中、取消/中断、归档及待处理输入继续等待。

可在 send 的 context 中附带来源任务、目标、背景、约束、预期回复及引用。需要接收保护时，inbox 读取传稳定 `consumerId`（如调用方任务 ID），同一 ID 连续翻页；`envelope.receipt.complete` 为 true 后，使用 acknowledge_message（messageId、consumerId、throughEvent=envelope.receipt.throughEvent）确认。服务端拒绝未读完或跳页确认，所有已登记读取者分别确认后才允许容量清理；无 consumerId 的旁观读取不取得保留权。每条最多 16 个读取者，不保护尚未登记的未来读取者。

完整记录最多 500 条，主库约 9 MB 上限，约 7 MB 已用页面提前清理，为日志留出空间使合计不超过 20 MB；不足时拒绝入队/暂停采集，不删除未处理消息。正文清理后的去重记录至少保留 7 天；清理后的旧游标明确报告历史缺口。schema 4 保留旧正文和事件，但撤销 schema 3 未经完整交付证明的旧确认。升级后确保执行的是新版入口，勿同时调用旧版远程连接；Codex 对话本身可以继续保留。

`stop_task` 只请求停止原生回合，不取消队列；若后续消息也不能发送，应先 pause。插件不自动打断任务、不批准权限、不修改 ZCode 数据库、不杀进程。
完整参数与故障处理见 [队列说明](docs/message-queue.md)，原生协议见 [协议记录](docs/zcode-remote-protocol.md)。

## 7. 验证与维护

`npm run smoke` 检查协议、分页、并发、持久化、幂等、迁移、暂停、按需启动、统一游标和默认 8 工具权限。发布还需插件结构校验与限定测试任务的实机往返。

显式实机检查：`node scripts/live-concurrency.mjs <已安装插件目录> <测试对话ID> <稳定批次ID> [只读监看对话ID...]`。仅向指定测试对话发送两条固定回复请求，并发去重、读取和两个接收者确认通过后恢复原暂停状态；其他对话只读。起始队列须暂停且没有未解决消息。该检查证明多调用者与单目标 FIFO，不等于两个不同目标同时运行模型；不要自动重跑未知发送。

旧 ACP 网关移至 `scripts/legacy-gateway.mjs`，只供主动诊断，不在默认插件中注册；`scripts/legacy-smoke.mjs` 保留其旧检查。旧工具名称在默认入口明确报错，不偷偷绕过队列；旧工具游标也不能代替新 `zcode_read` 游标，应重新读取建立基线。

## 8. 未来计划

1. 验证更可靠的原生回合结束关联，减少对助手正文存在的依赖；未验证前不降低完成判据。
2. 提供独立公开 marketplace 安装入口。
3. 按 [ZCode 侧插件草案](plans/2026-09-09-zcode-side-plugin.md) 验证反向发送与唤醒能力，当前不实施。
4. 官方可验证的新建接口出现前，仅控制已有任务；稳定后再评估其他智能体。

本轮实现及验证记录见 [消息回流计划](plans/2026-09-09-message-return.md)。
