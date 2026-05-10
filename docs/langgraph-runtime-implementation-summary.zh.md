# LangGraph Runtime 改造实现总结

## 背景

这次改造把 `dev-workflow` 的 workflow 执行层从旧的 `phases` 配置切到新的 LangGraph JSON DSL。

新的方向是：

- workflow 用 JSON DSL 定义。
- runtime 用 LangGraph `StateGraph` 执行。
- AI agent step、checkpoint、共享上下文、任务恢复都尽量走 LangGraph 原生模型。
- 长文本输出继续写入 task 目录下的 markdown artifact。
- LangGraph state 只保存轻量 metadata、session id、当前 step、checkpoint 决策和 artifact 索引。

这次不再考虑旧 workflow 格式兼容。

## 主要改动

### 1. 新增 LangGraph runtime 模块

新增目录：

```text
packages/core-lib/langgraph-runtime/
```

核心文件：

- `dsl.mjs`
  - 校验并规范化 LangGraph JSON DSL。
  - 要求 `runtime: "langgraph"`。
  - 支持 `agents`、`contextGroups`、`steps`、`inputs`、`outputs`、checkpoint routing、checkpoint publish。

- `builder.mjs`
  - 把 DSL 编译成 LangGraph `StateGraph`。
  - `agent` step 映射成 LangGraph node。
  - `checkpoint` step 映射成 `interrupt()`。
  - `approve/reject` 通过 conditional edge 路由。
  - 支持 checkpoint approve 后直接结束 workflow。

- `sdk-agent-adapter.mjs`
  - 负责调用 Claude Agent SDK / Codex SDK。
  - 根据 step/agent 的 `workspaceAccess` 决定只读或可写。
  - 把 AI 输出写入 markdown artifact。
  - 返回轻量 `summary`、`contentPreview`、`artifactPath` 给 LangGraph state。

- `app-adapter.mjs`
  - 把 LangGraph runtime 事件桥接到当前 app 的 task/state/message 文件。
  - 负责发送 UI/WebSocket 事件。
  - 负责 checkpoint `publish`：把审核输入发布成新的 artifact，并写回 `stepOutputs` / `stepArtifacts`。

- `artifacts.mjs`
  - 生成 `summary`、`contentPreview` 和 step output metadata。

## 新 DSL 结构

新的 workflow 文件必须是 LangGraph DSL，例如：

```json
{
  "id": "implement_task",
  "name": "implement a task",
  "version": 1,
  "runtime": "langgraph",
  "agents": {
    "planner": {
      "backend": "claude",
      "workspaceAccess": "read"
    },
    "coder": {
      "backend": "codex",
      "workspaceAccess": "write"
    }
  },
  "contextGroups": [
    {
      "id": "coding",
      "label": "Coding",
      "agent": "coder",
      "sharedSession": true
    }
  ],
  "steps": [
    {
      "id": "plan",
      "type": "agent",
      "agent": "planner",
      "next": "plan_review"
    },
    {
      "id": "plan_review",
      "type": "checkpoint",
      "approve": "implement",
      "rejectTo": "plan",
      "rejectTargets": ["plan"]
    },
    {
      "id": "implement",
      "type": "agent",
      "contextGroup": "coding"
    }
  ]
}
```

## Step 类型

### Agent Step

`agent` step 用于执行 Claude / Codex。

支持字段：

- `agent`
- `contextGroup`
- `skill`
- `instructions`
- `prompt`
- `workspaceAccess`
- `inputs`
- `outputs`
- `next`

执行时：

1. LangGraph node 读取 state。
2. 根据 step 找到 agent。
3. 根据 `contextGroup` 复用 session id。
4. 调用 Claude / Codex SDK。
5. 写 markdown artifact。
6. 把轻量 metadata 写回 state。

### Checkpoint Step

`checkpoint` step 用于人工审核。

支持字段：

- `question`
- `approve`
- `rejectTo`
- `rejectTargets`
- `publish`

执行时：

1. LangGraph node 调用 `interrupt()`。
2. UI 等待用户 approve / reject。
3. approve 后走 `approve` 指定 step。
4. reject 后走 `rejectTo` 或用户选择的 reject target。
5. 如果 `approve` 为空，approve 后 workflow 结束。

## Checkpoint Publish

这次补上了 checkpoint publish。

示例：

```json
{
  "publish": [
    {
      "action": "approve",
      "sourceName": "plan",
      "asOutputKey": "approved_plan",
      "filename": "plan.final.md"
    }
  ]
}
```

含义：

- checkpoint approve 后读取名为 `plan` 的 input。
- 把内容写入 `plan.final.md`。
- 在 state 中写入：
  - `stepOutputs[checkpointId].outputs.approved_plan`
  - `stepArtifacts[checkpointId].approved_plan`
- UI 可以继续通过当前 artifact 读取完整文档。

这解决了 `plan_review -> implement` 这种流程中，后续 step 需要读取 `approved_plan` 的问题。

## 共享 AI 上下文

共享上下文通过 `contextGroups` 实现。

例如：

```json
{
  "contextGroups": [
    {
      "id": "coding",
      "agent": "coder",
      "sharedSession": true
    }
  ]
}
```

所有使用 `contextGroup: "coding"` 的 step：

- 必须使用同一个 agent。
- 会复用同一个 SDK session/thread。
- session id 会写入 `state.sessionMap.coding`。

这次修复了 session key 不统一的问题，避免 session 被错误写到单个 step id 上。

## State 与 Artifact

这次采用混合方案：

- LangGraph state 保存轻量结构化数据。
- markdown artifact 保存完整正文。

state 主要保存：

```json
{
  "currentStep": "implement",
  "overallStatus": "in_progress",
  "sessionMap": {
    "coding": "codex-thread-id"
  },
  "stepOutputs": {
    "plan": {
      "summary": "Short summary",
      "contentPreview": "Preview text",
      "artifactPath": "/task/plan.draft.md",
      "status": "ready"
    }
  },
  "stepArtifacts": {
    "plan": "/task/plan.draft.md"
  }
}
```

完整正文仍然放在 task 目录：

```text
plan.draft.md
plan.final.md
implement.md
code-review.md
```

这样可以避免 LangGraph state 变得过大，也方便 UI、文件查看和后续同步。

## Desktop Runtime 改造

主要文件：

```text
apps/desktop/electron/workflow-runtime.mjs
```

改动内容：

- 使用 `buildWorkflowGraphFromDsl()` 创建 LangGraph runtime。
- 使用 `Command({ resume })` 处理 approve / reject。
- 使用 `thread_id = taskId:runId` 绑定 LangGraph checkpointer。
- 保留现有 task 目录、worktree、WebSocket event、state 文件结构。
- 新增 active graph 管理。
- 支持 workflow 完成后清理 worktree。
- 支持重新连接已有任务时重新发送 state 和 artifacts。

## 恢复逻辑

LangGraph 当前使用 `MemorySaver`。

进程不重启时：

- checkpoint interrupt 保存在内存 checkpointer。
- approve/reject 直接 `Command({ resume })` 即可继续。

进程重启后：

- 内存 checkpointer 丢失。
- app 仍然有 task 目录下的 `workflow-state.json`。
- runtime 会根据文件 state 用 `Command({ update, goto })` 重新挂回当前 checkpoint。
- 然后再执行 `Command({ resume })`。

这次已经补上这个恢复逻辑。

## UI 改造

主要文件：

```text
apps/desktop/renderer/src/WorkflowEditor.jsx
apps/desktop/renderer/src/components/WorkflowFlowchart.jsx
```

改动内容：

- workflow editor 改为面向 LangGraph DSL。
- 支持编辑：
  - agents
  - context groups
  - agent step
  - checkpoint step
  - inputs
  - outputs
  - routes
- 增加 JSON DSL preview。
- flowchart 改为展示 LangGraph node / route。

UI 中部分旧字段名仍然叫 `phase`，这是为了复用当前页面和 store 的展示结构；runtime 核心已经按 step / DSL 执行。

## 当前激活 Workflow

本机当前激活 workflow 已改成新的 LangGraph DSL：

```text
/Users/mac/Library/Application Support/dev-Workflow/workflows/plan-review-implement-review-test.json
```

旧文件已备份为：

```text
/Users/mac/Library/Application Support/dev-Workflow/workflows/plan-review-implement-review-test.legacy.bak
```

新的默认流程是：

```text
plan -> plan_review -> implement -> code_review -> user_review
```

其中：

- `plan` 使用 Claude。
- `plan_review` 是人工 checkpoint。
- `implement` 使用 Codex，并绑定 `contextGroup: "coding"`。
- `code_review` 使用 Claude。
- `user_review` 是最终人工 checkpoint。

## 验证结果

已执行并通过：

```bash
pnpm build:desktop
```

已验证：

- Electron runtime 可以正常 import。
- LangGraph checkpoint 可以 interrupt / resume。
- checkpoint approve 后可以 publish artifact。
- `contextGroup` 会写入共享 session key。
- 进程重启后可以根据文件 state 重新挂回 checkpoint 并继续 resume。

## 后续建议

下一步可以继续做三件事：

1. 把 UI 里的 `phase` 命名逐步替换成 `step`，减少概念混用。
2. 把 `MemorySaver` 换成文件型或数据库型 checkpointer，进一步增强跨进程恢复能力。
3. 给 DSL 增加更完整的循环 / 条件分支表达，而不是只依赖 checkpoint reject 回跳。
