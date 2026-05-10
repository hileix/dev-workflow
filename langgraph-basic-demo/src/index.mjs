import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
} from "@langchain/langgraph";

// ------------------------------------------------------------
// 1. 定义 workflow state
// ------------------------------------------------------------
// State 是整个 LangGraph workflow 共享的数据。
// 每个 node 都会读取 state，并返回一小段更新。
// LangGraph 会把这些更新合并回总 state。
const WorkflowState = Annotation.Root({
  // 用户最开始输入的任务。
  task: Annotation({
    default: () => "",
  }),

  // 当前 workflow 走到哪个阶段。
  currentPhase: Annotation({
    default: () => "created",
  }),

  // 模拟 AI 生成的计划。
  plan: Annotation({
    default: () => "",
  }),

  // 人工审批结果。
  approved: Annotation({
    default: () => false,
  }),

  // 模拟执行后的结果。
  result: Annotation({
    default: () => "",
  }),

  // 日志列表。reducer 表示多次更新 logs 时如何合并。
  logs: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

// ------------------------------------------------------------
// 2. 创建 node：分析任务
// ------------------------------------------------------------
// Node 就是 workflow 里的一个步骤。
// 这里不调用真实 AI，只用固定逻辑模拟“分析任务”。
async function analyzeTaskNode(state) {
  return {
    currentPhase: "analyzed",
    logs: [`Analyze task: ${state.task}`],
  };
}

// ------------------------------------------------------------
// 3. 创建 node：生成计划
// ------------------------------------------------------------
// 这个 node 读取上一步保存在 state.task 里的任务，
// 然后写入 state.plan。
async function createPlanNode(state) {
  const plan = [
    "1. Read the user's request",
    "2. Make a small implementation plan",
    "3. Ask for human approval",
    "4. Execute the plan after approval",
  ].join("\n");

  return {
    currentPhase: "plan_created",
    plan,
    logs: ["Create a simple plan"],
  };
}

// ------------------------------------------------------------
// 4. 创建 node：人工审批 checkpoint
// ------------------------------------------------------------
// interrupt() 会暂停 graph。
// 它的参数会出现在 result.__interrupt__ 里，外部程序可以把它展示给用户。
// 后面通过 new Command({ resume: ... }) 恢复时，resume 的值会成为 interrupt() 的返回值。
async function humanApprovalNode(state) {
  const approval = interrupt({
    phase: "human_approval",
    question: "Do you approve this plan?",
    plan: state.plan,
  });

  return {
    currentPhase: approval.approved ? "approved" : "rejected",
    approved: approval.approved,
    logs: [`Human decision: ${approval.approved ? "approved" : "rejected"}`],
  };
}

// ------------------------------------------------------------
// 5. 创建 conditional edge：根据审批结果选择下一步
// ------------------------------------------------------------
// 普通 edge 是固定流转，比如 A -> B。
// conditional edge 会读取 state，然后返回下一个 node 的名字。
function routeAfterApproval(state) {
  if (state.approved) return "execute";
  return "finish";
}

// ------------------------------------------------------------
// 6. 创建 node：执行计划
// ------------------------------------------------------------
// 这个 node 只会在 approved 为 true 时执行。
async function executePlanNode(state) {
  return {
    currentPhase: "executed",
    result: `Finished demo task: ${state.task}`,
    logs: ["Execute the approved plan"],
  };
}

// ------------------------------------------------------------
// 7. 创建 node：结束 workflow
// ------------------------------------------------------------
// 无论审批通过还是拒绝，最后都会进入 finish。
async function finishNode(state) {
  const message = state.approved
    ? "Workflow completed successfully"
    : "Workflow stopped because the plan was rejected";

  return {
    currentPhase: "finished",
    logs: [message],
  };
}

// ------------------------------------------------------------
// 8. 组装 graph
// ------------------------------------------------------------
// START 和 END 是 LangGraph 提供的特殊节点。
// addNode() 注册步骤。
// addEdge() 定义固定流转。
// addConditionalEdges() 定义分支流转。
const workflow = new StateGraph(WorkflowState)
  .addNode("analyze", analyzeTaskNode)
  .addNode("create_plan", createPlanNode)
  .addNode("human_approval", humanApprovalNode)
  .addNode("execute", executePlanNode)
  .addNode("finish", finishNode)
  .addEdge(START, "analyze")
  .addEdge("analyze", "create_plan")
  .addEdge("create_plan", "human_approval")
  .addConditionalEdges("human_approval", routeAfterApproval)
  .addEdge("execute", "finish")
  .addEdge("finish", END);

// ------------------------------------------------------------
// 9. 编译 graph，并启用 checkpointer
// ------------------------------------------------------------
// MemorySaver 是内存 checkpoint。
// 它能让 graph 暂停后，在同一个 Node.js 进程里继续恢复。
// 生产项目如果要跨进程/重启恢复，通常要换成数据库或文件型 checkpointer。
const graph = workflow.compile({
  checkpointer: new MemorySaver(),
});

// ------------------------------------------------------------
// 10. 创建运行配置
// ------------------------------------------------------------
// thread_id 可以理解为一次 workflow run 的 ID。
// 同一个 thread_id 会复用同一条 checkpoint 记录。
const config = {
  configurable: {
    thread_id: "demo-run-1",
  },
};

// ------------------------------------------------------------
// 11. 打印辅助函数
// ------------------------------------------------------------
// 为了让运行结果更容易看懂，这里统一格式化输出。
function printTitle(title) {
  console.log(`\n=== ${title} ===`);
}

function printState(state) {
  console.log(JSON.stringify(state, null, 2));
}

// ------------------------------------------------------------
// 12. 第一次启动 graph
// ------------------------------------------------------------
// graph.invoke(initialState, config) 会从 START 开始执行。
// 执行到 humanApprovalNode 的 interrupt() 时会暂停。
printTitle("Start workflow");
const firstResult = await graph.invoke(
  {
    task: "Build a small LangGraph demo",
  },
  config,
);

printState(firstResult);

// ------------------------------------------------------------
// 13. 检查是否暂停
// ------------------------------------------------------------
// isInterrupted() 用来判断 graph 是否因为 interrupt() 停住了。
// INTERRUPT 是 LangGraph 的特殊字段名，对应 result.__interrupt__。
if (!isInterrupted(firstResult)) {
  throw new Error("Expected the graph to pause at human approval.");
}

const pendingInterrupt = firstResult[INTERRUPT][0];

printTitle("Interrupt payload shown to the user");
printState(pendingInterrupt.value);

// ------------------------------------------------------------
// 14. 恢复 graph：模拟用户点击 Approve
// ------------------------------------------------------------
// Command({ resume }) 会把 resume 数据送回上一次 interrupt() 的位置。
// 在 humanApprovalNode 中，approval 变量会收到这个对象。
printTitle("Resume workflow with approval");
const finalResult = await graph.invoke(
  new Command({
    resume: {
      approved: true,
    },
  }),
  config,
);

printState(finalResult);

// ------------------------------------------------------------
// 15. 再运行一次：模拟用户拒绝
// ------------------------------------------------------------
// 这里换一个 thread_id，表示新开一条 workflow run。
// 这样不会复用 demo-run-1 的 checkpoint。
const rejectedConfig = {
  configurable: {
    thread_id: "demo-run-2",
  },
};

printTitle("Start another workflow and reject it");
await graph.invoke(
  {
    task: "Build a feature without approval",
  },
  rejectedConfig,
);

const rejectedResult = await graph.invoke(
  new Command({
    resume: {
      approved: false,
    },
  }),
  rejectedConfig,
);

printState(rejectedResult);
