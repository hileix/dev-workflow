# LangGraph State + Markdown Artifact 混合方案

## 结论

推荐使用混合方案：

- LangGraph `state` 保存轻量、结构化、适合 UI 展示和 runtime 判断的数据。
- task 目录下的 markdown artifact 保存 AI / skill 生成的完整正文。

也就是说，不建议把所有完整文档都长期塞进 LangGraph state。state 更适合保存“索引”和“摘要”，markdown 文件更适合保存“完整内容”。

## 为什么不只用 LangGraph state

LangGraph 的 state 可以保存 AI 返回的内容，也可以通过 checkpointer 持久化。

但是对 `dev-workflow` 来说，完整 plan、implementation、review、verification 文档可能会很长。如果全部放进 state，会带来几个问题：

- 每次 graph 流转都要携带大量文本。
- checkpoint payload 会变大。
- UI 同步、移动端同步、恢复任务时都要处理大对象。
- 长文本更适合用文件 diff、搜索、预览和版本记录。

所以 state 可以保存 AI 返回结果，但不应该成为完整文档仓库。

## 推荐的数据职责

### LangGraph state 保存什么

state 保存这些内容：

- 当前 step
- workflow 状态
- session id 映射
- checkpoint 决策
- 每个 step 输出的摘要
- 每个 step 输出的预览
- 每个 step 对应的 artifact 路径

示例：

```json
{
  "currentStep": "review",
  "overallStatus": "in_progress",
  "sessionMap": {
    "coding": "codex-thread-id"
  },
  "stepOutputs": {
    "plan": {
      "kind": "markdown",
      "summary": "Add a LangGraph runtime layer driven by JSON DSL.",
      "contentPreview": "# plan\n\nAdd a LangGraph runtime layer...",
      "artifactPath": "/task-output/plan.md",
      "status": "ready"
    }
  },
  "stepArtifacts": {
    "plan": "/task-output/plan.md"
  }
}
```

### Markdown artifact 保存什么

markdown 文件保存完整内容：

- 完整 plan
- 完整 code review
- 完整 implementation summary
- 完整 verification report
- 其他 skill 输出

例如：

```text
task-output/
  plan.md
  implementation.md
  verification.md
```

## Skill / AI step 如何执行

一个 agent step 的执行流程是：

1. LangGraph node 读取当前 state。
2. runtime 根据 DSL 找到 agent、skill、contextGroup。
3. adapter 调用 Claude Code SDK 或 Codex SDK。
4. AI 返回完整 markdown 内容。
5. runtime 把完整内容写入 task 目录下的 markdown 文件。
6. runtime 从完整内容提取 `summary` 和 `contentPreview`。
7. LangGraph state 只保存轻量 metadata。

这样 UI 可以直接读 state 展示列表和 timeline，也可以点击 artifact 路径打开完整文档。

## 多个 step 共享上下文

共享 AI 上下文仍然通过 `contextGroup` 实现。

例如：

```json
{
  "contextGroups": [
    {
      "id": "coding",
      "agent": "coder",
      "sharedSession": true
    }
  ],
  "steps": [
    {
      "id": "implement",
      "type": "agent",
      "contextGroup": "coding"
    },
    {
      "id": "verify",
      "type": "agent",
      "contextGroup": "coding"
    }
  ]
}
```

`implement` 和 `verify` 会使用同一个 agent，并通过 `sessionMap.coding` 复用同一个 SDK session/thread。

## checkpoint 如何使用 state

checkpoint 暂停时，payload 里只放轻量 state：

- task id
- run id
- 当前 step
- stepOutputs metadata
- stepArtifacts

人工审核界面可以展示摘要和预览。如果需要查看完整内容，再读取 artifact 文件。

## 当前代码实现

当前 demo runtime 已经按这个方案调整：

- `packages/core-lib/langgraph-runtime/artifacts.mjs`
  - 负责生成 summary、contentPreview、step output metadata。
- `packages/core-lib/langgraph-runtime/builder.mjs`
  - agent node 不再把完整正文写入 `stepOutputs`。
  - `stepOutputs[stepId]` 改为结构化 metadata。
- `packages/core-lib/langgraph-runtime/sdk-agent-adapter.mjs`
  - SDK 返回完整内容后写 markdown artifact。
  - state 只接收 summary、preview、artifactPath。
- `examples/langgraph-runtime/run-demo.mjs`
  - fake demo 也使用同样的 state 结构。

这个方案不会影响当前已有 app 的生产 workflow。它目前只作用在独立 LangGraph runtime demo 上。
