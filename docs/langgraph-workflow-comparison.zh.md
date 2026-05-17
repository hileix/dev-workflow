# LangGraph long graph 示例与当前 Workflow 设计对比

## 结论

当前 APP 不是完全按照 LangGraph 原生概念直接建模的。

更准确的描述是：

```text
自定义 Workflow JSON DSL
  -> 校验和归一化
  -> 编译成 LangGraph StateGraph
  -> 由桌面端 runtime 执行
  -> 状态、产物、消息和 checkpoint 落到本地任务目录
  -> UI 用 React Flow 展示和编辑 workflow
```

也就是说，当前 APP 已经使用 LangGraph 作为 workflow runtime，但产品层仍然是自己的 DSL、自己的状态文件、自己的桌面任务模型和自己的 UI 交互。

## 对比对象

本文对比两个东西：

- `docs/langgraph-example.md`：用“小明开发一个功能”的故事解释 LangGraph 的 11 个核心概念。
- 当前 APP 的 Workflow 实现：主要代码在 `packages/core-lib/langgraph-runtime/`、`packages/core-models/`、`apps/desktop/electron/workflow-runtime.ts` 和 `apps/desktop/renderer/src/WorkflowEditor.tsx`。

## 概念映射

| LangGraph 概念 | 当前 APP 是否有 | 当前实现 |
|---|---:|---|
| State | 有 | `WorkflowRuntimeState` + `workflow-state.json` |
| Nodes | 有 | DSL 中的 `steps` |
| 普通 Edges | 有 | `next` 字段 |
| Conditional Edges | 有 | `condition.passTo/failTo`、`checkpoint.approve/rejectTargets` |
| Graph | 有 | `buildWorkflowGraphFromDsl()` 创建 `StateGraph` |
| Compile | 有 | `builder.compile({ checkpointer })` |
| Checkpointer | 有 | `FileCheckpointSaver` 保存 LangGraph checkpoint |
| Streaming | 部分有 | APP 自己通过事件推送状态和 phase 内容 |
| Human-in-the-loop | 有 | `checkpoint` 节点调用 `interrupt()` |
| Command | 有 | approve/reject 用 `new Command({ resume })` |
| Send | 没有 | 当前没有 fan-out/fan-in 并行任务调度 |

## 当前 APP 已经符合 LangGraph 的部分

### 1. 有真实的 LangGraph runtime

当前 APP 不是只借用了 LangGraph 这个名字。`packages/core-lib/langgraph-runtime/builder.ts` 里确实使用了：

- `StateGraph`
- `Annotation`
- `START`
- `END`
- `interrupt`
- `Command`
- `MemorySaver`

`buildWorkflowGraphFromDsl()` 会把 DSL 中的 steps 编译成真正的 LangGraph graph。

### 2. 有 State

当前 runtime state 包含：

- `taskId`
- `runId`
- `workFolder`
- `taskDir`
- `currentStep`
- `overallStatus`
- `taskInputs`
- `sessionMap`
- `stepOutputs`
- `stepArtifacts`
- `stepDecisions`
- `pendingMessages`
- `pendingImagePaths`
- `logs`

同时，APP 还有一份产品层状态文件 `workflow-state.json`。这份状态不仅保存 LangGraph 运行信息，也保存 UI 和任务运行需要的信息，例如：

- `currentPhase`
- `phases`
- `steps`
- `workflowDefinition`
- `workflowConfig`
- `worktree`
- `artifacts`

这和 LangGraph 示例里的简单 `DevState` 不一样。示例里的 state 是纯业务状态；当前 APP 的 state 是“运行状态 + 产品状态 + agent session + artifact + worktree”的混合体。

### 3. 有 Node

示例里的 node 是任意函数，例如：

- 需求分析
- 技术方案
- 编码实现
- 自测
- 提交 CR
- 根据 CR 修改

当前 APP 也有 node，但被产品 DSL 收敛成固定类型：

- `agent`
- `condition`
- `checkpoint`
- `end`

这是一个重要差异：LangGraph 原生 node 可以是任意函数；当前 APP 的 node 是为了产品可配置性做过限制的业务节点。

### 4. 有普通边和条件边

当前 APP 的普通边来自 `next`。

当前 APP 的条件边有两类：

- `condition` 节点根据 agent 输出解析出的 `passed` 结果走 `passTo` 或 `failTo`。
- `checkpoint` 节点根据人工 approve/reject 走 `approve` 或 `rejectTargets`。

这和 `docs/langgraph-example.md` 中“自测失败回到编码实现”“CR 不通过回到修改”的概念是一致的。

### 5. 有 Human-in-the-loop 和 Command

当前 APP 的 `checkpoint` 节点会调用 `interrupt()` 暂停 workflow。

用户在 UI 中 approve 或 reject 后，Electron runtime 会用 `Command({ resume: ... })` 恢复 graph：

- approve：继续到 `approve` 指向的步骤
- reject：带上 reject reason，回到指定步骤

这和 LangGraph 示例里 reviewer 通过 Command 控制下一步的概念基本一致。

### 6. 有 Checkpointer

当前 APP 使用自定义 `FileCheckpointSaver`，并把 checkpoint 存到任务运行目录下的 `checkpoints`。

这说明 LangGraph checkpoint 是存在的，不只是 APP 自己写 `workflow-state.json`。

## 当前 APP 和 LangGraph 示例的主要差异

### 1. 当前 APP 是 DSL 驱动，不是直接手写 StateGraph

LangGraph 示例是这样的思路：

```python
builder = StateGraph(DevState)
builder.add_node(...)
builder.add_edge(...)
builder.add_conditional_edges(...)
```

当前 APP 是这样的思路：

```text
workflow JSON
  -> validateWorkflowDsl()
  -> buildWorkflowGraphFromDsl()
  -> StateGraph
```

这意味着用户面对的是产品 DSL，而不是 LangGraph 原生 API。

这个选择是合理的，因为 APP 需要让 workflow 可编辑、可保存、可切换、可通过 UI 展示，而不是让用户直接写 TypeScript/Python graph。

### 2. 当前 DSL 比 LangGraph 原生能力窄

当前 DSL 只允许这些 step 类型：

- `agent`
- `condition`
- `checkpoint`
- `end`

它没有暴露 LangGraph 的完整表达能力，例如：

- 任意自定义 node 函数
- 任意 state schema
- 自定义 reducer
- subgraph
- dynamic Send
- map-reduce 风格的并行调度

这不是 runtime 做不到，而是当前产品 DSL 没有设计这些能力。

### 3. 当前 Streaming 是产品事件流，不是直接暴露 LangGraph stream

`docs/langgraph-example.md` 里的 Streaming 更接近 LangGraph 执行事件流。

当前 APP 的 UI 主要消费自己定义的事件，例如：

- `state`
- `phase_content`
- `phase_artifact`
- `phase_interaction`
- `phase_failed`
- `workflow_starting`
- `worktree_ready`

所以当前有“实时看板效果”，但它不是把 LangGraph 原始 stream 原样暴露给前端。

### 4. 当前没有 Send 并行调度

示例里的 `Send` 用来把一个任务拆成多个并行分支，例如前端和后端同时执行。

当前 APP 没有对应能力：

- DSL 没有 `send` / `fanout` / `parallel` 节点。
- runtime builder 没有使用 LangGraph `Send`。
- state 也没有为多个并行子任务设计聚合结构。

所以当前 workflow 更适合：

- 线性执行
- 条件分支
- 条件循环
- 人工 checkpoint
- reject 回跳

不适合原生表达复杂并行工作流。

### 5. 当前状态模型更偏产品运行，而不是纯图状态

LangGraph 示例里的 state 是工作流内部状态。

当前 APP 还要处理桌面产品自己的概念：

- task run 目录
- worktree
- artifact 文件
- phase markdown
- agent session id
- UI graph shape
- Electron 和本地 server 通信
- task 列表状态

所以当前 state 不可能只是一个简单的 LangGraph state。它同时承担了本地桌面工作流产品的数据持久化职责。

## 当前默认 Workflow 的实际形态

以 `docs/workflows/default-codex.json` 和 `docs/workflows/default-claude-code.json` 为例，默认 workflow 大致是：

```text
implement
  -> code_review
  -> risk_gate
    -> pass: review
    -> fail: implement
  -> review
    -> approve: commit_and_push
    -> reject: implement
  -> commit_and_push
  -> END
```

这个结构和 `docs/langgraph-example.md` 中的小明开发流程非常接近：

- `implement` 对应编码实现
- `code_review` 对应代码审查
- `risk_gate` 对应自测/质量门禁
- `review` 对应人工 CR 审批
- reject 回到 `implement` 对应根据 CR 修改
- approve 后进入 `commit_and_push` 对应提交和合并流程

差异是，当前 APP 把这些流程产品化成了可编辑 JSON，并且把 agent backend、model、workspace access、worktree、输出文件都放进 workflow 配置里。

## 是否“完全按照 LangGraph 概念设计”

答案：不是完全按照。

更准确的判断：

1. Runtime 层已经比较接近 LangGraph。
2. 产品配置层不是 LangGraph 原生概念，而是自定义 Workflow DSL。
3. UI 层使用 React Flow 表达图，但它展示的是产品 DSL 的 graph shape，不是 LangGraph 内部 graph 对象。
4. 状态持久化是双层的：LangGraph checkpoint + APP 自己的 `workflow-state.json`。
5. 当前没有实现 LangGraph 的 `Send` 并行调度能力。

所以这不是“纯 LangGraph APP”，而是“LangGraph-backed workflow app”。

## 这个设计的优点

### 1. 更适合产品化

直接暴露 LangGraph 原生 API 会很灵活，但不适合普通 UI 编辑。

当前 DSL 把复杂能力收敛成几个产品节点，用户更容易理解：

- agent step
- condition step
- checkpoint step
- end step

### 2. 更容易接入桌面工作流能力

当前 APP 的核心不是单纯跑 graph，而是帮用户完成真实开发任务。

所以它需要 LangGraph 之外的能力：

- 创建 worktree
- 调用 Claude/Codex SDK
- 写 markdown artifact
- 管理任务目录
- 暂停、继续、拒绝、追加反馈
- commit、push、创建 PR

这些能力放在自定义 runtime 适配层里，比硬塞进 LangGraph 原生概念里更清晰。

### 3. 更可控

限制 DSL 能力可以避免用户构造过于复杂或不可控的 graph。

对于当前产品阶段，线性流程、条件循环和人工审批已经覆盖主要开发工作流。

## 这个设计的限制

### 1. 并行工作流能力弱

如果未来要支持“前端实现”和“后端实现”同时跑，再汇总结果，当前 DSL 需要扩展。

可能需要增加：

- `parallel` step
- `fanout` / `fanin`
- 子任务 state
- 多分支 artifact 汇总
- 多 agent 并发执行 UI

### 2. State schema 不够通用

当前 state 是为开发工作流设计的，不是一个通用的可配置 state schema。

如果未来要支持更通用的业务 workflow，可能需要让 DSL 能声明：

- state fields
- reducer
- input/output schema
- artifact schema

### 3. UI graph 和 runtime graph 不是完全同一个对象

UI 使用的是 `workflowConfig.graph` 这种产品化 graph shape。

它和 LangGraph 内部编译后的 graph 不是同一个对象。正常情况下这没问题，但如果未来加入更复杂的 LangGraph 特性，UI 表达能力也要同步升级。

## 建议

短期不需要追求“完全 LangGraph 原生化”。

当前设计更适合这个 APP：

- 产品层保留自定义 DSL
- runtime 层继续用 LangGraph
- 状态层保留 `workflow-state.json` 做桌面产品持久化
- checkpoint 继续用 LangGraph checkpoint
- UI 继续展示产品 DSL graph

如果下一步要更接近 LangGraph，优先级建议是：

1. 增加 `parallel` / `Send` 能力，支持真正的并行 agent 分支。
2. 明确 LangGraph checkpoint 和 `workflow-state.json` 的职责边界。
3. 把 Streaming 事件定义整理成稳定协议，而不是直接暴露 LangGraph 原始事件。
4. 只有在需要通用 workflow 平台时，再考虑开放 state schema、reducer 和 subgraph。

## 一句话总结

当前 APP 没有完全照搬 LangGraph 的所有概念，但已经把 LangGraph 用在了最关键的执行层。它的架构本质是：用自定义 DSL 做产品表达，用 LangGraph 做状态图执行，用桌面 runtime 处理真实开发工作流所需的文件、agent、worktree 和人工审批。
