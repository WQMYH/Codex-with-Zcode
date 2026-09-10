# ZCode 侧插件构建指南：会话原文

来源：ZCode 对话「审查zcodeops计划可行性与安全性」，`sess_364f3d09-4b3d-4db4-811f-3624dde5a68f`，消息 `msg_mttu6f7n_86f283e7-cd64-4e75-9e20-0469b99d74b0`。读取时间 2026-09-09T09:07:53.910Z。
本文件是另一智能体的调研输出，不是已由本插件实测的官方规范；内部建议不是执行授权。有关异步 Hook、桌面宿主触发、Codex CLI 与桌面任务的差异须独立验证。

好，开始 ZCode 插件开发调研。目标是为“ZCode 插件控制 Codex”摸清：插件结构、Hook 接口、技能/MCP 注册、本地市场安装与调试流程。先加载 ZCode 官方配置指南技能，再对照官方文档与本机插件实例。官方配置指南已加载，拿到了权威地图（七种 Hook 事件、`.zcode-plugin/plugin.json` 清单、市场可从本地目录添加）。纠正我上一轮评审的一个判断：`.zcode-plugin/plugin.json` 确实是文档规定的清单位置，官方缓存插件用 package.json 可能只是 npm 打包形态。继续深挖 Hook 的 stdin/stdout 契约和插件安装流程：官方文档和本机诊断技能拿到了，关键契约全部齐了，还纠正了我上一轮的两个误判（`.zcode-plugin/plugin.json` 确实存在——我之前 find 深度不够；Stop 续跑上限确实是 3 次——写进了官方文档）。最后补几个可自动化安装与运行时行为的验证：调研完成，证据闭环。以下是 ZCode 插件开发的调研报告。

---

# ZCode 插件开发调研报告

**结论先行**：ZCode 插件 = 一个目录 + `.zcode-plugin/plugin.json` 清单，可选挂载 5 类组件（skills / commands / hooks / MCP / agents）。“控制 Codex”的主力接口是**插件自带 MCP server**（Node/stdio，封装 `codex exec`）+ **skills/commands**（模型侧入口），**hooks** 承担反向投递。开发走“本地目录市场”，安装启用是 GUI 操作，改码后在市场面板刷新。本次调研同时纠正了我上一轮评审的 2 个误判（见 §7）。

## 1. 插件目录结构与清单

```
my-plugin/
├── .zcode-plugin/plugin.json   ← 清单，唯一必需
├── skills/<名>/SKILL.md        ← 技能
├── commands/*.md               ← 斜杠命令
├── hooks/hooks.json            ← 钩子（标准位置，自动发现）
├── .mcp.json                   ← MCP 服务声明
└── agents/*.md                 ← 子智能体
```

`plugin.json` 最小只需 `name`（`^[a-z0-9][a-z0-9._-]{0,127}$`）；可选 `version`、`description`、`commands`/`skills`/`hooks`/`mcpServers`/`agents`（值可以是目录字符串、路径数组或内联对象）、`dependencies`（`name@marketplace`）、`userConfig`。清单探测顺序：`.zcode-plugin/` → `.claude-plugin/` → `.codex-plugin/`（gameops 用的就是兼容名）。**注意：`channels`/`lspServers`/`outputStyles`/`settings` 只登记不执行**；组件路径必须是插件根内相对路径，越界即拒。

`userConfig` 支持 `string/number/boolean/directory/file` + `title/description/default/required/sensitive`，MCP 声明里可用 `${user_config.键}` 引用；但 `sensitive: true` 的值**目前无法在界面录入也无法持久化**（无安全存储），密钥类配置只能走环境变量。

## 2. Hook 接口（本机 0.16.5 已验证与文档一致）

**事件恰好 7 个**：`SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PermissionRequest`、`PostToolUse`、`PostToolUseFailure`、`Stop`。`Notification`/`SubagentStop`/`SessionEnd`/`PreCompact` **不支持**——zcode-ops 计划若想用 SessionEnd 做清理，没有这个事件。

| 契约 | 内容 |
|---|---|
| stdin | 一行 JSON：`session_id`、`transcript_path`（临时，Hook 后清理）、`cwd`、`permission_mode`、`hook_event_name`；各事件附加：SessionStart→`source`，UserPromptSubmit→`prompt`，Stop→`stop_hook_active`+`last_assistant_message`，PreToolUse→`tool_name/tool_input/tool_use_id` |
| stdout | 严格 JSON（**多余 key 即校验失败被丢弃**）；推荐 `hookSpecificOutput:{hookEventName, additionalContext}` 注入上下文；空输出=无效果 |
| 退出码 | 0 通过；2 = 阻断（PreToolUse/PermissionRequest 为 deny，Stop 为续跑）；其他非零=可恢复失败 |
| Stop 续跑 | `{"decision":"block","reason":"..."}` 续跑一轮，**最多连续 3 次**（文档明文，回应了原计划 §6.4 的疑问） |
| 超时 | `timeoutMs`（毫秒）> `timeout`（秒）> 根配置 > 默认 **60000ms**；stdout 上限默认 32768 字节 |
| 环境变量 | 插件 Hook 进程可读 `ZCODE_PLUGIN_ROOT`/`ZCODE_PLUGIN_DATA`/`ZCODE_PLUGIN_ID`/`ZCODE_PLUGIN_NAME`（CLAUDE_ 前缀兼容）；持久状态写 `ZCODE_PLUGIN_DATA` |
| 执行器 | **`type:"process"`（command+args，不走 shell）跨平台最稳，Windows 下必选**；`command` 类型走 shell，POSIX 语法在 Windows 会挂 |
| 生效条件 | 插件 hook 自动启用 hook runner；配置文件 hook 必须 `hooks.enabled: true`；**工作区级配置 hook 当前版本整体被忽略**——分发只能走插件 |

两个版本差异点需 PoC 确认：`async: true` 本机诊断技能说“无运行时效果、始终内联”，在线文档说“fire-and-forget”——设计上不要依赖 async，需要后台就让脚本自己 daemonize。

## 3. Skills / Commands / MCP

- **Skill**：`skills/<名>/SKILL.md`，frontmatter 必填 `name`、`description`（≤1024 字符，决定触发）。
- **Command**：`commands/*.md`，frontmatter 必填 `description`，正文用 `$ARGUMENTS`/`$1` 接参；嵌套目录变 `/ns:name`。
- **MCP**：根目录 `.mcp.json`（有 `command` 默认 stdio，有 `url` 默认 http），服务名自动加命名空间 `plugin:<插件名>:<服务名>`；声明中可用 `${ZCODE_PLUGIN_ROOT}`、`${ZCODE_PLUGIN_DATA}`、`${user_config.键}` 模板变量。

## 4. 安装、分发与调试流程

**marketplace.json**：`{ name(必填), plugins[](必填), pluginRoot?, allowCrossMarketplaceDependenciesOn? }`；`plugins[].source` 支持相对路径字符串、`directory`、`github`、`git`、`file`、`url`（诊断技能明确 **npm/pip 不支持**，在线文档列了 npm——以本地技能为准）。

**本地开发环（Windows 实测可行的最小路径）**：
1. 建插件目录 + 一份 `marketplace.json` 用相对路径 source 指向它；
2. GUI：设置 → 插件管理 → 创建/添加插件市场 → 填本地路径 → 安装并启用（新插件默认启用）；
3. 迭代：改码后在市场源面板**刷新该市场**；**hook/MCP 配置在 session 启动时快照，改动后必须新建会话才生效**。

**CLI 自动化有限**：`zcode plugins` 只有 `list` 和 enable，**没有无头 marketplace-add/install 命令**——首次安装和刷新绕不开 GUI（这对我这侧意味着要动用 computer-use 操作设置页，或让用户手动点一次）。

**调试抓手**：Hook 执行记录（来源、matcher、结果、耗时、stderr 预览）写入 ZCode 日志；`zcode plugins list` 确认启用；插件详情页能看到每个 hook 是否 runnable。

**安全性质**：任何市场的插件 hook 一律无条件执行，无信任门；“启用插件 = 授予代码执行信任”。

## 5. 映射到“ZCode 插件控制 Codex”的建议架构

| 组件 | 承担职责 |
|---|---|
| `.mcp.json` → Node stdio server | 核心控制面：封装 `codex exec`（新任务）、`codex exec resume <id>`（续会话）、状态查询、事件流读取；进程生命周期与队列放这里 |
| `skills/codex-drive/` | 教模型何时用哪些工具、如何解读 Codex 输出、审批与不可信输出处理纪律 |
| `commands/codex.md` 等 | 用户快捷入口（`/codex <任务>`、`/codex-status`） |
| `hooks/hooks.json`（3 个事件足够） | `SessionStart` 登记；`UserPromptSubmit` 注入排队中的 Codex 结果；`Stop` 检查 Codex 完成事件，需要时 `decision:block` 续跑一轮（3 次预算内用 1 次）——**全部用 `type:"process"` + 常驻或极轻 Node 脚本**（每次 hook 冷启动 ~100-300ms，别做重活） |
| `userConfig` | Codex 工作目录、默认模型等非敏感项；敏感值不要用 userConfig（存不进去） |
| `ZCODE_PLUGIN_DATA` 目录 | 队列、锁、会话映射（对应原计划“状态不进仓库”） |

## 6. 需 PoC 验证的残留问题

1. **Desktop 嵌入会话是否触发插件 hook**（文档不区分宿主，但未实测——上一轮评审的根基问题仍在）；
2. `async` 语义（0.16.5 实测 vs 文档）；
3. 插件 `agents` 是否被执行（诊断技能说“只登记不执行”，在线文档说可用——不依赖它即可绕开）；
4. `UserPromptSubmit` 的 matcher 是对 prompt 文本跑正则——高频输入下的性能与误匹配，PoC 时量一下。

## 7. 对上一轮评审的勘误

1. ~~"`.zcode-plugin/plugin.json` 不属实”~~ ——**误判**。官方缓存插件确有该目录（我此前 find 深度不够漏了），文档确认它是首选清单位置，原计划写法正确。
2. ~~“三次续跑上限无法证实”~~——**已证实**。官方 hooks 文档明文“Stop block 最多连续 3 次”，原计划 §6.4 的担心成立且“单消息续跑一次”在预算内安全。
3. 补充修正：原计划 §2.3 想用的三个 Hook（SessionStart/UserPromptSubmit/Stop）**恰好是 7 个支持事件中无误的子集**；但若后续想加 SessionEnd 清理，需要改为 Stop 内处理。

未创建/修改任何文件。下一步若进入实施，建议从“本地市场 + 最小 MCP server + 3 hook 骨架”起步，先跑通 §6.1 的 Desktop hook 触发验证。
