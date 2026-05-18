# TODO: Agent Activity 与 Terminal 原生输出模式

## Background

当前任务运行页已经有三块核心信息：

- 左侧：workflow step 列表和每个 step 的状态
- 中间：当前 step 的输出文档，例如 implementation summary、code review、risk decision
- 右侧：AI conversation / tool activity

中间区域不是聊天框，而是 step 的最终产物区。真正需要调整的是右侧 AI activity 面板。

现在右侧由 Web UI 自己渲染 AI 消息、tool call、loading 状态和用户反馈。这种方式更产品化，但也带来一个问题：每次 Codex 或 Claude Code 的输出形态变化，APP 都需要维护自己的渲染逻辑。

用户希望右侧能像 terminal 一样直接显示 Codex / Claude Code 的原生对话和执行过程，从而减少自定义 Web chat UI 的维护成本。

## Goal

采用方案 C，但主线直接从真实 Terminal 模式开始：

```text
默认：结构化 Agent Activity
高级：嵌入真实 Terminal 原生输出
底层：继续接入 workflow runtime
```

目标不是立刻用 terminal 替代整个右侧面板，而是在右侧增加一个模式切换：

- `Activity`：当前产品化、结构化的 AI 活动视图
- `Terminal`：高级模式，尽量接近 Codex / Claude Code CLI 的原生终端体验

这样可以同时保留 workflow 产品体验和 terminal 原生调试体验。

这里不再要求先做 terminal-like log。  
如果目标是减少 Web UI 渲染逻辑，应该直接做 PTY-backed CLI terminal。

## Current State

当前代码里，右侧 AI 面板主要由以下模块支撑：

- `apps/desktop/renderer/src/StepDetail.jsx`
  - 负责显示 step 文档和右侧 conversation
  - `normalizeConversation()` 会把 `assistant_delta`、`tool_use` 等 interaction 组合成可渲染消息
  - 当前已经有 loading row、tool 折叠块、用户输入框

- `apps/desktop/renderer/src/pages/TaskPage.jsx`
  - 任务详情页入口
  - 负责选择当前 workflow step，并把 step 的 content、artifact、interactions 传给 `StepDetail`

- `packages/core-lib/langgraph-runtime/sdk-agent-adapter.mjs`
  - 目前 Claude 走 `@anthropic-ai/claude-agent-sdk`
  - Codex 走 `@openai/codex-sdk`
  - 运行时把 SDK stream 转成 `onText`、`onTool`、`onSession`

这意味着当前 runtime 本质上是 SDK stream 模式，不是真正的 PTY terminal 模式。

因此不能假设“把当前 SDK 会话直接塞进 terminal 就能得到原生 CLI UI”。要直接做真实 terminal，需要新增一条 CLI / PTY runtime path。

- SDK stream 输出：可以渲染成 terminal-like log
- CLI / PTY 输出：可以得到更接近真实 terminal 的交互体验

本需求选择后者作为主线。

## Proposed UX

右侧面板顶部增加一个轻量切换：

```text
Agent Activity
[ Activity ] [ Terminal ]
```

### Activity Tab

默认打开，保留当前产品化视图。

它继续显示：

- AI 消息
- tool call 折叠块
- loading 状态
- 用户反馈输入框
- checkpoint / reject 后的继续对话

这个 tab 面向普通 workflow 使用。

### Terminal Tab

高级模式，显示更接近命令行的输出。

它应该适合这些场景：

- 想看 Codex / Claude Code 的原始输出
- 想确认工具执行过程
- 想调试 agent 卡住或失败的原因
- 想减少 Web chat UI 对特殊消息格式的适配成本

Terminal tab 应该是真实 terminal。是否允许用户直接输入可以分阶段控制，但底层需要按真实 PTY session 设计。

## Architecture Direction

### 主线：PTY-backed CLI Session

技术链路建议：

```text
StepDetail Terminal Tab
  -> xterm.js
  -> Electron IPC or local WebSocket
  -> node-pty
  -> codex / claude CLI
```

`xterm.js` 负责前端 terminal 渲染，`node-pty` 负责在 Electron main 或 local server 中启动真实命令行进程。

这一阶段需要明确 runtime 选择：

- SDK 模式：继续用于结构化 workflow 执行、artifact、state、mobile relay
- CLI/PTY 模式：用于高级 terminal 体验和调试

TODO：评估并实现用 Codex CLI / Claude Code CLI 直接替换当前 `@openai/codex-sdk` / `@anthropic-ai/claude-agent-sdk` adapter。目标是拿到 CLI 原生能力和最新 flags，例如 Codex `--dangerously-bypass-approvals-and-sandbox`、Claude Code `--dangerously-skip-permissions`，同时保持 workflow state、artifact、session resume 和 debug event 的回写能力。

注意：PTY 模式不能绕开 workflow state。即使 terminal 显示原生 CLI 输出，最终 step 状态、artifact、session id、错误信息仍然要回写到当前 task run。

### Resume 策略

恢复对话优先依赖 Claude Code / Codex 自己的 resume 能力。

语义上要区分：

- `resume`：恢复 agent session，让同一个 Codex / Claude Code 会话继续执行
- `terminal transcript`：恢复 UI 里曾经显示过的原始终端 scrollback

如果只需要“继续上次对话和执行”，可以优先使用 CLI / SDK 的 resume。

如果还需要“重新打开任务后看到之前 terminal 里的每一行输出”，才需要额外保存 transcript。

因此 transcript 持久化是可选增强，不是接入真实 terminal 的前置阶段。

### 长期方向：Activity 与 Terminal 双写

长期目标是让同一次 agent run 同时产生两种视图：

```text
Agent raw stream
  -> raw terminal transcript
  -> structured workflow events
```

这样可以做到：

- Activity tab 给普通用户看
- Terminal tab 给高级用户看
- 中间 step output 继续只显示最终 artifact
- workflow state 仍然保持结构化、可恢复、可被 mobile 查看

## UI Requirement

### 1. 右侧面板增加模式切换

在 `StepDetail.jsx` 的右侧 conversation header 附近增加切换控件：

- `Activity`
- `Terminal`

默认选择 `Activity`。

切换只影响右侧显示方式，不影响中间 step document。

### 2. Activity 保持现有行为

第一版不要重写现有 Activity UI，只做必要整理：

- 继续显示 loading row
- 继续支持 tool 折叠
- 继续支持用户反馈输入
- 继续支持 reject 后继续对话

### 3. Terminal 展示规则

Terminal tab 使用真实 terminal 组件展示 CLI 输出。

要求：

- 支持 ANSI 颜色和格式
- 支持流式输出
- 支持滚动
- 支持 resize
- 当前 step 切换时不能串 session
- step 完成后 terminal 不应该清空，除非用户显式关闭或重新运行

### 4. Terminal 输入策略

第一版可以先做只读 terminal。

原因：

- 当前 workflow 的用户反馈已经走 `sendWorkflowMessage`
- 直接开放 raw terminal input 会绕开 workflow 的 pending message / resume 机制
- 先只读可以降低风险，但底层仍按真实 PTY session 设计

后续可以增加可输入模式，但需要先明确：

- 输入是否直接进入 CLI
- 输入是否也要写入 workflow messages
- Ctrl+C / Ctrl+D / exit 如何影响 workflow step 状态

### 5. 空状态

当当前 step 没有 interactions 时：

- Activity tab 显示现有空状态
- Terminal tab 显示类似：

```text
No terminal session for this step yet.
```

## Runtime Requirement

### 1. 不改变中间 Step Output 语义

中间区域继续只代表当前 step 的最终输出文档。

不要把 terminal transcript 写进中间文档。

### 2. 保持 Desktop source of truth

task run、workflow state、artifact、messages 仍然以 Desktop 本地数据为准。

Terminal tab 只是右侧展示层，不应该让 backend 或 mobile 成为新的状态源。

### 3. Resume 优先，Transcript 可选

恢复 agent 会话优先使用 Claude Code / Codex 的 resume 能力。

如果需要恢复 terminal scrollback，再为每个 step 保存 raw transcript。

建议文件位置：

```text
taskDir/
  terminal/
    <runId>/
      <stepId>.ansi.log
```

用途：

- task reload 后还能恢复 terminal scrollback
- Debug 时可以查看原始输出
- 后续可以支持导出日志

注意：transcript 不是 workflow 的状态源。它只是 terminal UI 的历史记录。

### 4. 结构化事件不能丢

即使有 terminal transcript，也不能只保存 raw text。

workflow 仍然需要结构化事件来支持：

- step 状态
- loading 判断
- artifact 更新
- checkpoint approve / reject
- mobile 只读查看
- history / resume

## Technical Notes

### 推荐依赖

真实 terminal 模式建议使用：

- `@xterm/xterm`
- `@xterm/addon-fit`
- `node-pty`

`xterm.js` 适合在 Web/Electron renderer 里嵌入 terminal。  
`node-pty` 适合在 Node/Electron main 侧启动 PTY 进程，并支持 input、output、resize。

### 可能新增模块

- `apps/desktop/electron/terminal-session.mjs`
  - 管理 PTY session 生命周期

- `apps/desktop/electron/main.mjs`
  - 增加 terminal IPC handler

- `apps/desktop/electron/preload.cjs`
  - 暴露 terminal API 给 renderer

- `apps/desktop/renderer/src/components/AgentTerminal.jsx`
  - 基于 `xterm.js` 的真实 terminal 组件

### IPC 草案

进入 PTY 阶段后，可以考虑这些 API：

```text
terminal:startSession({ taskId, runId, stepId, backend, cwd, command })
terminal:write({ sessionId, data })
terminal:resize({ sessionId, cols, rows })
terminal:stop({ sessionId })
terminal:onData(callback)
terminal:onExit(callback)
```

## Implementation Plan

### Phase 1：接入真实 Terminal Tab

目标：在右侧加入真实 PTY-backed Terminal tab。

改动范围：

- `StepDetail.jsx`
- 新增 `AgentTerminal.jsx`
- 新增 Electron terminal session 管理
- 增加 terminal IPC
- 引入 `@xterm/xterm`、`@xterm/addon-fit`、`node-pty`
- 必要时补充 i18n 文案

验收标准：

- 右侧可以在 `Activity` 和 `Terminal` 之间切换
- 默认仍然是 `Activity`
- `Terminal` 可以显示真实 Codex / Claude CLI 输出
- terminal 支持 resize
- task / step 切换时 session 不串线
- 不影响中间 step document
- 不影响现有 Activity tab
- `pnpm build:desktop` 通过

### Phase 2：接入 Resume 与 Workflow State Bridge

目标：让真实 CLI session 能服务 workflow run，而不是只作为独立 terminal。

改动范围：

- 为 Codex / Claude CLI session 接入 resume
- 将 CLI 运行结果回写 workflow state
- 将 step 成功、失败、停止状态映射到 workflow state
- 确保 step artifact 仍然能写入中间输出文档

验收标准：

- 重新打开任务后，可以继续同一个 agent session
- step 完成后 workflow 状态正确
- agent 失败时 workflow 能进入 failed 状态
- step output artifact 仍然正常生成或读取
- `pnpm build:desktop` 通过

### Phase 3：可选保存 Raw Transcript

目标：如果 resume 不能满足历史查看需求，再保存 terminal scrollback。

改动范围：

- PTY output 写入 `<stepId>.ansi.log`
- task reload 时读取 transcript
- Terminal tab 可以恢复历史 scrollback

验收标准：

- task 重开后 Terminal tab 仍能看到历史输出
- 每个 step 的 transcript 独立保存
- transcript 不污染 step output artifact

## Out Of Scope For Now

- 不移除现有 Activity UI
- 不在第一版支持用户直接在 terminal 内输入
- 不在第一版支持 mobile 端 terminal
- 不在第一版做完整 terminal 搜索、复制、导出
- 不把中间 step document 改成聊天或 terminal

## Risks

### 1. Terminal 原生体验和 Workflow 状态可能脱节

如果直接跑 CLI，但不把结果回写 workflow state，APP 会只剩一个“看起来在跑”的 terminal，workflow 本身无法可靠完成。

应对：

- PTY 阶段必须设计 state bridge
- step status、artifact、error 必须仍然由 workflow runtime 管理

### 2. CLI 输出不一定稳定

Codex / Claude Code CLI 的 UI 输出可能更适合人看，不一定适合程序解析。

应对：

- 不依赖 raw terminal text 判断 step 成败
- 成败和 artifact 仍然走结构化 runtime 事件

### 3. 安全边界更复杂

PTY 模式意味着用户可能直接输入命令。

应对：

- 第一版只读
- 真正支持输入前，需要明确 cwd、权限、停止、审计和 session 清理规则

## Open Questions

- 第一版 Terminal tab 是否只读？
- Terminal tab 默认是否对所有用户展示，还是放进 Debug / Advanced 模式？
- PTY-backed CLI 是否只支持 Codex，还是同时支持 Claude Code？
- 如果 SDK 模式和 CLI 模式输出不一致，以哪个为准？
- 只依赖 Codex / Claude resume 是否足够，还是必须额外保存 raw transcript？
- raw transcript 如果保存，是否需要支持搜索和导出？
