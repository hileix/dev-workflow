# LangGraph Basic Demo

这个目录是一个独立的 LangGraph 学习示例，不会修改或依赖当前主项目的代码。

## 运行方式

```bash
cd langgraph-basic-demo
pnpm install
pnpm start
```

## 你会看到什么

这个示例演示 LangGraph 的几个核心概念：

- `State`：整个 workflow 共享的数据。
- `Node`：workflow 中的一个步骤。
- `Edge`：步骤之间的流转关系。
- `Conditional Edge`：根据 state 决定下一步走哪里。
- `Interrupt`：暂停 workflow，等待人工输入。
- `Command({ resume })`：从暂停点继续执行。
- `MemorySaver`：内存中的 checkpoint，用于同一次进程内恢复。

## 注意

这个示例不调用任何真实 LLM，也不需要 API Key。里面的 AI 行为都是用普通函数模拟的，目的是先理解 LangGraph 的运行模型。
