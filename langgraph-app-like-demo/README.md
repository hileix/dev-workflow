# LangGraph App-Like Demo v2

这个示例是独立项目，不会改动主项目代码。

它模拟的是你当前 APP 里的那种流程：

- 任务接入
- 计划生成
- 人工审批
- 进入实现子流程
- 工具执行
- 验证
- 结束

同时尽量把 LangGraph 的常见概念都串起来：

- `State`
- `Node`
- `Edge`
- `Conditional Edge`
- `START` / `END`
- `interrupt()`
- `Command({ resume })`
- `MemorySaver`
- `stream()`
- `subgraph`
- 并行分支
- 多个 interrupt
- reducer 合并状态

## 运行

```bash
cd langgraph-app-like-demo
pnpm install
pnpm start
```

## 说明

这个 demo 不依赖 API Key，也不调用真实模型。
为了便于理解，所有“AI 行为”都用本地函数模拟了。

## 和当前 APP 的对应关系

| 当前 APP 概念 | 这个 demo 里的概念 |
| --- | --- |
| workflow phase | LangGraph node |
| phaseOrder | graph edge |
| approve / reject | `interrupt()` + `Command({ resume })` |
| workflow-state.json | LangGraph state |
| WebSocket event | `stream()` 输出 |
| implementation phase | implementation subgraph |
| tool 使用 | local tool node-like flow |
| task run id | `thread_id` |

## 没有刻意加入的内容

LangGraph 还有一些生产环境相关能力，比如数据库 checkpointer、自定义 store、真实 LLM tool calling、LangSmith tracing 等。
这些内容需要额外服务或 API Key，不适合放进这个本地入门 demo。
