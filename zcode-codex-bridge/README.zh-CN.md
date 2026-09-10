[EN](README.md) | [中文](README.zh-CN.md)

# ZCode Codex Bridge

<code>zcode-codex-bridge</code> 是本仓库提供的 ZCode 侧配套插件。它通过本机官方适配器，向一个已配置的 Codex Desktop 任务发送一次受限固定回报。

0.2.4 已通过离线检查，并完成活动任务投递、忙碌拒绝和 <code>notLoaded</code> 唤醒的实机验证。

## 在共同分发中的角色

- <code>zcode-ops</code> 运行在 Codex 中，负责读取、排队和控制已有的 ZCode Desktop 任务。
- <code>zcode-codex-bridge</code> 运行在 ZCode 中，向一个绑定的 Codex Desktop 任务发送固定回报。
- 两个插件使用不同宿主和清单，必须分别安装和配置。

它不是通用 Codex 控制器；ZCode 不能通过它选择任意任务、提示词、模型、批准策略或权限设置。

## 支持的工具与行为

插件提供四个 MCP 工具：

| 工具 | 行为 |
| --- | --- |
| <code>codex_binding_status</code> | 检查本地绑定并报告过期时间、回执统计和仅含元数据的 Hook 状态，不连接 Codex。 |
| <code>codex_thread_read</code> | 只读取绑定任务摘要，不返回任务历史。 |
| <code>codex_host_report</code> | 通过已经运行的 Codex 桌面适配器发送一次不可变固定回报，必须提供 <code>requestId</code>。 |
| <code>codex_fixed_reply_test</code> | 已退役的独立进程候选，生产环境保持阻断。 |

<code>codex_host_report</code> 有两种模式：

- 默认模式：完成目标身份和目录的新鲜核对后，即使绑定任务处于活动状态也发送固定回报。
- <code>requireIdle: true</code>：只有新鲜状态为 <code>idle</code> 或 <code>notLoaded</code> 时才发送；其他状态返回 <code>not_idle</code> 和 <code>sent: false</code>，不会等待或轮询。

每个 request ID 都会在投递前获得独占本地回执，并发重复请求不能同时发送。缺少确认时状态保持 <code>uncertain</code>，不得换新 ID 重试。<code>accepted</code> 只证明宿主接受，不证明 Codex 已收到、完成或返回预期文本。

## 安全边界

- 只允许一个已配置的 Codex 任务 ID 和精确工作目录。
- ZCode 绑定和桌面宿主绑定都会过期。
- 回报正文和大写固定回执令牌不可由调用方替换。
- 只允许访问官方宿主适配器的 <code>read_thread</code> 和 <code>send_message_to_thread</code> 工具。
- 不向 ZCode 暴露任务历史。
- 不修改模型、批准、权限或安全设置。
- 不自动重试、循环回送、后台轮询或唤醒 ZCode 会话。
- 配置中的 ZCode 会话和 team 值只是来源标签，不是身份认证。

<code>host-config.json</code>、发送回执、管道地址和 Hook 样本只能保存在本机插件数据目录，不得提交或打包。

## 安装与绑定

1. 在 ZCode 打开工作区，进入 **设置 → 插件 → 创建 → 添加插件市场**，输入 <code>WQMYH/Codex-with-Zcode</code> 或仓库 GitHub 地址。
2. 从 marketplace <code>codex-with-zcode</code> 安装 <code>zcode-codex-bridge</code>。本地开发仍可添加 <code>&lt;repository&gt;/zcode-codex-bridge</code>，使用原有 <code>zcode-codex-local</code> 市场。
3. 配置 <code>plugin/.zcode-plugin/plugin.json</code> 声明的字段：

   - <code>codex_script</code>：已安装的 <code>@openai/codex/bin/codex.js</code>
   - <code>codex_thread_id</code>：固定目标任务 ID
   - <code>codex_cwd</code>：目标任务的精确目录
   - <code>source_session_id</code>：ZCode 来源标签
   - <code>team_id</code>：受限 team 标签
   - <code>binding_expires_at</code>：ISO-8601 过期时间
   - <code>expected_reply</code>：大写固定回执令牌

4. 在获得授权的 Codex 任务环境中保存短期桌面宿主绑定：

   ~~~text
   node "<installed-plugin-directory>/scripts/host-client.mjs" --configure-host <plugin-data-directory> <official-app-tools-server.mjs> <ISO-expiry>
   ~~~

   该命令需要当前 Codex 桌面环境，只在插件数据目录写入 <code>host-config.json</code>，不会输出管道地址。

5. 新建 ZCode 会话，使插件和配置加载生效。

宿主绑定与当前 Codex 桌面进程耦合。桌面重启后必须重新绑定；不得猜测或把旧端点持久化到仓库。

## 使用

先调用 <code>codex_binding_status</code>，确认目标、目录、过期时间和 <code>hostReportConfigured: true</code>；需要新鲜状态时调用 <code>codex_thread_read</code>。

获得明确授权后，只用一个新的稳定 request ID 调用一次 <code>codex_host_report</code>。投递期间不得运行目标任务时，加上 <code>requireIdle: true</code>。投递结果与之后的 Codex 回传必须分别解释：

- <code>accepted</code>、<code>sent: true</code>：桌面宿主已接受消息。
- <code>not_idle</code>、<code>sent: false</code>：目标不是 <code>idle</code> 或 <code>notLoaded</code>，没有发送。
- <code>uncertain</code>：投递可能已经发生；不得换新 ID 重试。
- <code>deduplicated: true</code>：同一 request ID 返回已有回执。

协调器转交的回传必须标注为协调器中继，不能冒充插件直接投递。

## 验证

在 <code>plugin/</code> 中运行：

~~~text
npm test
node --check scripts/server.mjs
node --check scripts/host-client.mjs
node --check scripts/self-test.mjs
node --check hooks/probe.mjs
~~~

无依赖测试覆盖绑定校验、目标和目录核对、活动/忙碌/空闲/<code>notLoaded</code> 路径、request 去重、未知投递、过期、历史剥离、MCP 生命周期、Hook 保留和清单解析。

2026-09-09 已完成实机验收：

- 向活动中的 Codex 任务直接投递通过。
- 一次性 ZCode 往返确认通过。
- 活动任务使用 <code>requireIdle: true</code> 时返回 <code>not_idle</code>、<code>sent: false</code>。
- 直接唤醒 <code>notLoaded</code> 任务通过；原生 Codex 回合只回复 <code>ZCODE_CONFIRM_ONLY</code>，且没有调用工具。

实机证据见 [TEST-RESULTS.md](TEST-RESULTS.md)。全仓库后续工作继续记录在[未来计划](../README.zh-CN.md#未来计划)中。

## 目录结构

~~~text
marketplace.json                 ZCode 本地 marketplace
plugin/.zcode-plugin/plugin.json
plugin/.mcp.json                 MCP 服务注册
plugin/scripts/server.mjs        受限 MCP 接口
plugin/scripts/host-client.mjs   官方桌面适配器客户端
plugin/scripts/self-test.mjs     无依赖验证
plugin/hooks/                    仅含元数据的生命周期探针
plugin/skills/                   ZCode 使用说明
~~~
