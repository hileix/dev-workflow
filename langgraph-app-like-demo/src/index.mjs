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
// 1. 一些通用小工具
// ------------------------------------------------------------
// 这里的辅助函数只是为了让输出更好读，不属于 LangGraph 核心概念。
function title(text) {
  console.log(`\n=== ${text} ===`);
}

function dump(value) {
  console.log(JSON.stringify(value, null, 2));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeInterruptValue(value) {
  return typeof value === "string" ? value.trim() : value;
}

// ------------------------------------------------------------
// 2. 本地工具：模拟“工具调用”
// ------------------------------------------------------------
// 这几个函数就是我们的“工具”。
// 它们不是真实的模型工具调用，但能帮助你理解 tool node 的作用。
const localTools = {
  inspectWorkspace: async ({ task, branchName }) => {
    await wait(80);
    return `Workspace looks clean for "${task}" on branch "${branchName}".`;
  },
  draftPatch: async ({ task, branchName, approved }) => {
    await wait(80);
    return `Draft patch created for "${task}" on branch "${branchName}". Approved=${approved}.`;
  },
  runVerification: async ({ task }) => {
    await wait(80);
    return `Verification passed for "${task}".`;
  },
};

// ------------------------------------------------------------
// 3. 定义主流程的 state
// ------------------------------------------------------------
// State 是 workflow 的共享数据。
// 每个 node 都能读到 state，也能返回局部更新。
// LangGraph 会把这些更新合并回总 state。
const AppState = Annotation.Root({
  task: Annotation({
    default: () => "",
  }),
  currentPhase: Annotation({
    default: () => "idle",
  }),
  plan: Annotation({
    default: () => "",
  }),
  approved: Annotation({
    default: () => false,
  }),
  reviewNotes: Annotation({
    default: () => "",
  }),
  branchName: Annotation({
    default: () => "",
  }),
  riskAccepted: Annotation({
    default: () => false,
  }),
  toolCalls: Annotation({
    default: () => [],
  }),
  toolResults: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  patchNotes: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  verified: Annotation({
    default: () => false,
  }),
  logs: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

// ------------------------------------------------------------
// 4. 定义实现子流程的 state
// ------------------------------------------------------------
// 子图可以有自己的 state schema。
// 这里只保留实现阶段真正需要的字段。
const ImplementState = Annotation.Root({
  task: Annotation({
    default: () => "",
  }),
  currentPhase: Annotation({
    default: () => "implementing",
  }),
  branchName: Annotation({
    default: () => "",
  }),
  riskAccepted: Annotation({
    default: () => false,
  }),
  toolCalls: Annotation({
    default: () => [],
  }),
  toolResults: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  patchNotes: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  logs: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

// ------------------------------------------------------------
// 5. 主流程节点：接收任务
// ------------------------------------------------------------
// 这个 node 很像你当前 APP 的任务进入阶段。
async function intakeNode(state) {
  return {
    currentPhase: "intake",
    logs: [`[intake] received task: ${state.task}`],
  };
}

// ------------------------------------------------------------
// 6. 主流程节点：生成计划
// ------------------------------------------------------------
// 这一步模拟“计划阶段”。
// 它把一个任务拆成更小的步骤，和你当前 workflow 的 plan phase 很像。
async function planNode(state) {
  const plan = [
    "1. Review the task and scope",
    "2. Ask for human approval",
    "3. Run an implementation subgraph",
    "4. Execute local tools",
    "5. Verify the result",
  ].join("\n");

  return {
    currentPhase: "planning",
    plan,
    logs: ["[plan] created a small execution plan"],
  };
}

// ------------------------------------------------------------
// 7. 主流程节点：人工审批
// ------------------------------------------------------------
// interrupt() 会暂停图执行。
// 这里模拟你当前 APP 的 approve / reject 交互。
async function reviewNode(state) {
  const decision = interrupt({
    phase: "human_review",
    question: "Approve this workflow run?",
    task: state.task,
    plan: state.plan,
  });

  const approved = Boolean(decision?.approved);
  return {
    currentPhase: approved ? "approved" : "rejected",
    approved,
    reviewNotes: String(decision?.notes || ""),
    logs: [`[review] ${approved ? "approved" : "rejected"}`],
  };
}

// ------------------------------------------------------------
// 8. 子流程节点：并行的人工问题 1
// ------------------------------------------------------------
// 这个节点会和下面的 riskQuestionNode 并行执行。
// 这就是多个 interrupt 的示例。
async function branchQuestionNode() {
  const answer = interrupt({
    phase: "branch_question",
    question: "What branch name should we use?",
  });

  return {
    branchName: String(normalizeInterruptValue(answer?.branchName || answer || "") || ""),
    logs: ["[implement-subgraph] branch name collected"],
  };
}

// ------------------------------------------------------------
// 9. 子流程节点：并行的人工问题 2
// ------------------------------------------------------------
// 这是第二个并行 interrupt。
// 两个节点会一起停住，然后可以一次性 resume。
async function riskQuestionNode() {
  const answer = interrupt({
    phase: "risk_question",
    question: "Is the risk level acceptable?",
  });

  return {
    riskAccepted: Boolean(answer?.riskAccepted),
    logs: ["[implement-subgraph] risk decision collected"],
  };
}

// ------------------------------------------------------------
// 10. 子流程节点：准备工具调用
// ------------------------------------------------------------
// 这一步把接下来要执行的“工具列表”准备出来。
// 这就是 tool concept 的一个简单版本。
async function prepareToolsNode(state) {
  return {
    toolCalls: [
      {
        name: "inspectWorkspace",
        args: {
          task: state.task,
          branchName: state.branchName || "unknown-branch",
        },
      },
      {
        name: "draftPatch",
        args: {
          task: state.task,
          branchName: state.branchName || "unknown-branch",
          approved: state.riskAccepted,
        },
      },
    ],
    logs: ["[implement-subgraph] prepared tool calls"],
  };
}

// ------------------------------------------------------------
// 11. 子流程节点：执行工具
// ------------------------------------------------------------
// 这一步模拟 LangGraph 里的 tool node。
// 它读取 toolCalls，然后逐个执行对应的工具函数。
async function toolExecutorNode(state) {
  const results = [];

  for (const call of state.toolCalls || []) {
    const tool = localTools[call.name];
    if (!tool) continue;

    const output = await tool(call.args || {});
    results.push({
      name: call.name,
      output,
    });
  }

  return {
    toolResults: results,
    logs: [`[tool-node] executed ${results.length} tool(s)`],
  };
}

// ------------------------------------------------------------
// 12. 子流程节点：整理实现结果
// ------------------------------------------------------------
// 这一步把工具结果整理成更像“产物”的内容。
async function draftPatchNode(state) {
  const patch = [
    `Branch: ${state.branchName}`,
    `Risk accepted: ${state.riskAccepted}`,
    `Task: ${state.task}`,
    `Tool results: ${state.toolResults.map((item) => item.output).join(" | ")}`,
  ].join("\n");

  return {
    patchNotes: [patch],
    logs: ["[implement-subgraph] drafted patch notes"],
  };
}

// ------------------------------------------------------------
// 13. 子流程组装
// ------------------------------------------------------------
// 这个子图会先并行收集两个人工输入，
// 然后再继续做工具调用和 patch 草稿。
const implementGraph = new StateGraph(ImplementState)
  .addNode("branch_question", branchQuestionNode)
  .addNode("risk_question", riskQuestionNode)
  .addNode("prepare_tools", prepareToolsNode)
  .addNode("tool_executor", toolExecutorNode)
  .addNode("draft_patch", draftPatchNode)
  .addEdge(START, "branch_question")
  .addEdge(START, "risk_question")
  .addEdge("branch_question", "prepare_tools")
  .addEdge("risk_question", "prepare_tools")
  .addEdge("prepare_tools", "tool_executor")
  .addEdge("tool_executor", "draft_patch")
  .addEdge("draft_patch", END);

const implementationSubgraph = implementGraph.compile({
  checkpointer: new MemorySaver(),
});

// ------------------------------------------------------------
// 14. 主流程节点：调用子图
// ------------------------------------------------------------
// 子图可以像一个普通 node 一样挂到主图上。
// 这就是 LangGraph 很重要的“subgraph”概念。
async function implementNode(state) {
  return {
    currentPhase: "implementing",
    logs: ["[implement] entering implementation subgraph"],
  };
}

// ------------------------------------------------------------
// 15. 主流程节点：验证
// ------------------------------------------------------------
// 这里模拟验证阶段。
async function verifyNode(state) {
  const verification = await localTools.runVerification({ task: state.task });

  return {
    verified: true,
    currentPhase: "verified",
    logs: [`[verify] ${verification}`],
    patchNotes: [`[verify] checked ${state.patchNotes.length} patch note(s)`],
  };
}

// ------------------------------------------------------------
// 16. 主流程节点：结束
// ------------------------------------------------------------
async function finishNode(state) {
  return {
    currentPhase: "finished",
    logs: [
      state.approved
        ? "[finish] workflow completed"
        : "[finish] workflow stopped after rejection",
    ],
  };
}

// ------------------------------------------------------------
// 17. 主流程路由
// ------------------------------------------------------------
// 这里用 conditional edge 来决定 approval 后的走向。
function routeAfterReview(state) {
  return state.approved ? "implement" : "finish";
}

// ------------------------------------------------------------
// 18. 主流程组装
// ------------------------------------------------------------
// 主图的结构很像你现在的 APP：
// intake -> plan -> review -> implement(subgraph) -> verify -> finish
const appGraph = new StateGraph(AppState)
  .addNode("intake", intakeNode)
  .addNode("create_plan", planNode)
  .addNode("review", reviewNode)
  .addNode("implement", implementationSubgraph)
  .addNode("prepare_tools", prepareToolsNode)
  .addNode("tool_executor", toolExecutorNode)
  .addNode("verify", verifyNode)
  .addNode("finish", finishNode)
  .addEdge(START, "intake")
  .addEdge("intake", "create_plan")
  .addEdge("create_plan", "review")
  .addConditionalEdges("review", routeAfterReview, ["implement", "finish"])
  .addEdge("implement", "prepare_tools")
  .addEdge("prepare_tools", "tool_executor")
  .addEdge("tool_executor", "verify")
  .addEdge("verify", "finish")
  .addEdge("finish", END);

const app = appGraph.compile({
  checkpointer: new MemorySaver(),
});

// ------------------------------------------------------------
// 20. 第一次运行：走到人工审批处暂停
// ------------------------------------------------------------
// 这一步对应你当前 APP 里“计划后等待 approve / reject”。
title("Run 1: stop at human review");
const run1Config = {
  configurable: {
    thread_id: "demo-app-like-1",
  },
};

const first = await app.invoke(
  {
    task: "Add a LangGraph demo that feels like the current workflow app",
  },
  run1Config,
);

dump(first);

if (!isInterrupted(first)) {
  throw new Error("Expected the graph to pause at human review.");
}

// ------------------------------------------------------------
// 21. 恢复第一次运行：批准后进入实现子图
// ------------------------------------------------------------
// 这里先批准主流程。
// 然后子图里的两个并行 interrupt 会一起出现。
title("Run 1: approve and enter implementation subgraph");
const approvedStage = await app.invoke(
  new Command({
    resume: {
      approved: true,
      notes: "Looks good, continue.",
    },
  }),
  run1Config,
);

dump(approvedStage);

if (!isInterrupted(approvedStage)) {
  throw new Error("Expected the implementation subgraph to pause on multiple interrupts.");
}

// ------------------------------------------------------------
// 22. 处理多个 interrupt
// ------------------------------------------------------------
// LangGraph 支持多个 interrupt。
// 在复杂图或子图里，它们可能一次性出现，也可能分批出现。
// 所以这里写成一个小函数：看到什么问题，就给对应问题准备答案。
function buildResumeMap(interrupts) {
  const resumeMap = {};

  for (const item of interrupts || []) {
    if (!item?.id) continue;
    if (item.value?.phase === "branch_question") {
      resumeMap[item.id] = {
        branchName: "feat/langgraph-app-like-demo",
      };
    } else if (item.value?.phase === "risk_question") {
      resumeMap[item.id] = {
        riskAccepted: true,
      };
    }
  }

  return resumeMap;
}

// ------------------------------------------------------------
// 23. 用 stream() 循环恢复，直到 workflow 跑完
// ------------------------------------------------------------
// 这个函数做三件事：
// 1. 把 interrupt 答案 resume 回 graph。
// 2. 用 stream() 打印后续节点更新。
// 3. 如果 stream 过程中又遇到新的 interrupt，就继续 resume。
async function resumeWithStreamingUntilDone(initialInterrupts) {
  let nextInterrupts = initialInterrupts || [];

  while (nextInterrupts.length > 0) {
    const resumeMap = buildResumeMap(nextInterrupts);
    nextInterrupts = [];

    const stream = await app.stream(
      new Command({
        resume: resumeMap,
      }),
      {
        configurable: {
          thread_id: "demo-app-like-1",
        },
        streamMode: "updates",
        subgraphs: true,
      }
    );

    for await (const chunk of stream) {
      if (Array.isArray(chunk) && chunk.length === 2) {
        const [namespace, update] = chunk;
        console.log(`[stream ${namespace.join(" / ") || "root"}]`);
        dump(update);

        if (update?.__interrupt__) {
          nextInterrupts = update.__interrupt__;
        }
      } else {
        console.log("[stream]");
        dump(chunk);

        if (chunk?.__interrupt__) {
          nextInterrupts = chunk.__interrupt__;
        }
      }
    }
  }
}

// 这里会先恢复已经出现的 interrupt。
// 如果子图里还有新的 interrupt，resumeWithStreamingUntilDone() 会继续处理。
await resumeWithStreamingUntilDone(approvedStage[INTERRUPT] || []);

// ------------------------------------------------------------
// 24. 第二次运行：直接拒绝
// ------------------------------------------------------------
// 这一步演示 reject 分支，和你当前 APP 的 reject / rollback 很像。
title("Run 2: reject at human review");
const run2Config = {
  configurable: {
    thread_id: "demo-app-like-2",
  },
};

const second = await app.invoke(
  {
    task: "Demonstrate the rejection branch",
  },
  run2Config,
);

dump(second);

const rejected = await app.invoke(
  new Command({
    resume: {
      approved: false,
      notes: "Not now.",
    },
  }),
  run2Config,
);

dump(rejected);

// ------------------------------------------------------------
// 25. 总结提示
// ------------------------------------------------------------
title("Done");
console.log("这个 demo 已经包含了：state、node、edge、conditional edge、interrupt、resume、checkpointer、stream、subgraph、parallel interrupts、tool node-like flow。");
