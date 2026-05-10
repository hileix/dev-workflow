# Dev Workflow 的 LangGraph Runtime 方案

## 目标

把当前 `dev-workflow` 的 workflow 执行层改成：

1. 先用 JSON DSL 定义 workflow。
2. 再用 LangGraph 作为 workflow/task runtime。
3. 尽量使用 LangGraph 原生能力实现：
   - state
   - node
   - edge
   - conditional edge
   - interrupt / resume
   - checkpoint
   - subgraph
   - stream
   - 循环
   - 任务中断和恢复

## 你当前 workflow 的核心需求

### 1. AI agent step

每个 step 可以是一个 AI agent。

这个 step 需要支持：

- 输入内容
- 通过 skill 生成 prompt
- 输出内容
- 输出内容写入 task 目录下的 markdown 文件
- 也可以不输出文件，只更新 state

### 2. checkpoint step

每个 step 也可以是人工检查点。

这个 step 需要支持：

- approve
- reject
- approve 后进入下一步
- reject 后回退到指定 step

### 3. shared context

workflow 里可以定义哪些步骤共享同一个 AI 上下文。

如果几个步骤共享上下文，那么：

- 它们必须使用同一个 AI backend
- 它们必须共享同一个 session id
- 它们的上下文需要通过 LangGraph state 持续传递

### 4. 循环 / 中断 / 恢复

workflow 需要支持：

- 循环执行
- 人工中断
- 断点恢复
- reject 回跳

## 推荐架构

### A. JSON DSL 负责描述 workflow

DSL 只负责定义，不负责执行。

建议 DSL 至少包含这些部分：

- `agents`
- `contextGroups`
- `steps`
- `edges`
- `outputs`
- `inputs`
- `checkpoint`
- `loop`
- `workspaceAccess`

### B. LangGraph 负责 runtime

LangGraph 负责：

- 把 DSL 编译成 graph
- 执行每一个 step
- 管理 state
- 处理 interrupt / resume
- 处理 checkpoint
- 处理循环和分支

### C. 现有项目保留适配层

项目自己继续负责：

- skill 读取
- markdown 文件写入
- task 目录管理
- worktree
- WebSocket event
- mobile sync
- session id 管理

## DSL 建议结构

```json
{
  "id": "dev-workflow",
  "name": "Dev Workflow",
  "version": 1,
  "agents": {
    "planner": {
      "backend": "claude",
      "skill": "plan",
      "contextKey": "plannerMessages"
    },
    "coder": {
      "backend": "codex",
      "skill": "implement",
      "contextKey": "coderMessages"
    }
  },
  "contextGroups": [
    {
      "id": "coding",
      "agent": "coder",
      "sharedSession": true
    }
  ],
  "steps": [
    {
      "id": "plan",
      "type": "agent",
      "agent": "planner",
      "next": "review"
    },
    {
      "id": "review",
      "type": "checkpoint",
      "approve": "implement",
      "rejectTo": "plan"
    },
    {
      "id": "implement",
      "type": "agent",
      "contextGroup": "coding",
      "next": "verify"
    },
    {
      "id": "verify",
      "type": "agent",
      "contextGroup": "coding",
      "next": "finish"
    }
  ]
}
```

## DSL 到 LangGraph 的映射

### agent step

对应一个 node。

node 内部：

- 读取 state
- 读取 skill
- 选择 agent backend
- 复用或创建 session id
- 运行 AI
- 写 markdown 文件
- 返回 state 更新

### checkpoint step

对应一个 node + `interrupt()`

node 内部：

- 暂停 workflow
- 等待 approve / reject
- resume 后根据 decision 进入不同分支

### shared context

对应 state 里的：

- `sessionMap`
- `messagesByContextKey`
- `agentContextByGroup`

同一个 `contextGroup` 的 step：

- 只能绑定同一个 agent
- 只能使用同一个 session id

### 循环

对应 conditional edge。

比如：

- `verify -> implement`
- `reject -> plan`
- `fix -> verify`

## 推荐的 state 设计

```ts
{
  taskId: string;
  runId: string;
  currentStep: string;
  overallStatus: string;
  contextValues: Record<string, string>;
  sessionMap: Record<string, string>;
  stepOutputs: Record<string, {
    kind: "markdown";
    summary: string;
    contentPreview: string;
    artifactPath: string;
    status: "ready" | "skipped" | "failed";
  }>;
  stepArtifacts: Record<string, string>;
  stepLogs: string[];
  stepDecisions: Record<string, { approved: boolean; notes?: string }>;
}
```

`stepOutputs` 不建议保存完整 markdown 正文。推荐保存轻量 metadata，完整内容写入 task 目录下的 markdown artifact。详细说明见 `docs/langgraph-state-artifact-hybrid.zh.md`。

## 推荐的 runtime 分层

```text
DSL JSON
  -> validator
  -> graph builder
  -> LangGraph compile
  -> runtime executor
  -> artifact writer
  -> event adapter
```

## 最小可行实现顺序

1. 先支持 `agent` 和 `checkpoint`。
2. 再支持 `rejectTo` 回跳。
3. 再支持 `contextGroup` 和共享 session id。
4. 再支持 `loop`。
5. 最后支持 subgraph 和更复杂的 agent 编排。

## SDK agent adapter

当前 LangGraph runtime 已经有一个独立的 SDK adapter：

```js
import { createSdkAgentAdapter } from "../packages/core-lib/langgraph-runtime/index.mjs";
```

它支持：

- `backend: "claude"` -> `@anthropic-ai/claude-agent-sdk`
- `backend: "codex"` -> `@openai/codex-sdk`

DSL 中可以这样配置：

```json
{
  "agents": {
    "planner": {
      "backend": "claude",
      "skill": "plan",
      "workspaceAccess": "read"
    },
    "coder": {
      "backend": "codex",
      "skill": "implement",
      "workspaceAccess": "write",
      "options": {
        "thread": {
          "modelReasoningEffort": "medium"
        }
      }
    }
  }
}
```

共享上下文仍然通过 `contextGroup` 绑定：

```json
{
  "contextGroups": [
    { "id": "coding", "agent": "coder", "sharedSession": true }
  ]
}
```

这样 `implement` 和 `verify` 如果都使用 `contextGroup: "coding"`，它们就会复用同一个 Codex thread id。

目前这个 adapter 还没有接入现有 Electron workflow 启动链路。它已经可以被 LangGraph builder 使用，但旧的 `runPhase` 流程保持不变。

## 结论

你的这个 workflow 很适合做成：

**JSON DSL 定义 workflow，LangGraph 负责执行 runtime，项目自身保留文件、session、UI 和事件同步。**
