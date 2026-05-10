# Dify 中的 Graph Runtime 分层说明

基于本地源码仓库 `references/dify` 分析，版本为 `90fe54c`，远端为 `https://github.com/langgenius/dify.git`。

这份文档只回答一个问题：

**在 Dify 里，一个 workflow 可以拆成哪三层，以及用户点一次 Run 之后，这三层是怎么串起来的。**

## 1. 三层模型

如果把 workflow 拆开看，可以分成三层：

1. `Graph Definition`
2. `Graph Runtime State`
3. `Graph Runtime Engine`

这三层不是一回事。

### 1.1 Graph Definition

这是静态定义层，回答的是：

- 图里有哪些节点
- 节点之间怎么连
- 每个节点的配置是什么
- workflow 级功能和变量是什么

在 Dify 里，这一层主要由 `Workflow` 模型承载：

- `graph`
- `features`
- `environment_variables`
- `conversation_variables`
- `rag_pipeline_variables`

其中 `graph` 本身就是 workflow 画布 DSL，核心包含：

- `nodes`
- `edges`
- `viewport`

也就是说，Dify 的 workflow 不是把节点和边拆成很多张强关系表，而是直接把整份画布 JSON 持久化。

对应实现：

- `references/dify/api/models/workflow.py`
- `references/dify/web/service/workflow.ts`

## 1.2 Graph Runtime State

这是动态状态层，回答的是：

- 这一次 run 现在跑到哪了
- 当前变量池里有什么值
- 哪些节点已经完成
- 哪些节点正在运行
- 哪些节点正在等待 human input
- 当前 workflow 是 `running`、`paused`、`failed` 还是 `completed`

在 Dify 里，这一层不是单一对象，而是两部分一起组成：

### A. Graphon 的内存态

底层状态对象来自 `graphon`：

- `GraphRuntimeState`
- `VariablePool`

它们负责承载一次执行中的内存上下文。

### B. Dify 自己的持久化状态

Dify 又把运行中的关键状态落到自己的 repository / database 里，包括：

- workflow run
- node execution
- pause state
- event snapshot

这样做的目的不是多此一举，而是为了支持：

- streaming 事件输出
- run history
- pause / resume
- 客户端断线后事件重建

所以更准确地说：

**Dify 的 Graph Runtime State = Graphon 内存运行态 + Dify 自己的持久化执行状态**

对应实现：

- `references/dify/api/core/app/apps/workflow/app_runner.py`
- `references/dify/api/services/workflow_event_snapshot_service.py`

## 1.3 Graph Runtime Engine

这是执行引擎层，回答的是：

- 下一个该跑哪个节点
- 节点输出怎么进入下游节点
- 分支怎么选
- loop 怎么继续
- child graph 怎么创建
- stop / cancel / resume 怎么处理

在 Dify 里，这一层真正的核心是：

- `graphon.GraphEngine`

Dify 并没有自己从零写一套图调度器，而是把图执行交给 `graphon`，自己负责外围包装。

对应实现：

- `references/dify/api/core/workflow/workflow_entry.py`

所以一句话总结三层关系：

- `Graph Definition`：Dify 自己的 workflow DSL
- `Graph Runtime State`：`GraphRuntimeState + VariablePool + Dify 持久化状态`
- `Graph Runtime Engine`：`graphon.GraphEngine`

## 2. Dify 里三层分别由什么实现

把上面的定义映射到具体代码，可以直接落成下面这张表。

| 层 | Dify 中的实现 |
| --- | --- |
| Graph Definition | `Workflow.graph` 及相关 features / variables |
| Graph Runtime State | `graphon.GraphRuntimeState`、`VariablePool`、workflow run / node execution / pause records |
| Graph Runtime Engine | `graphon.GraphEngine` |

如果再往外包一层“产品级入口”，Dify 自己还加了三层应用包装：

- `AppGenerateService`
- `WorkflowAppGenerator`
- `WorkflowAppRunner`

它们不属于图引擎本身，但负责把 Dify 的 app、用户、SSE、Celery、数据库、追踪系统接到图引擎上。

## 3. 用户点一次 Run 之后，完整链路是什么

下面按顺序看一次 workflow run。

## 3.1 前端先取 Graph Definition

用户在控制台里点击 Run 之前，前端画布维护的是 workflow draft。

前端会先拿到 draft workflow：

- graph
- features
- variables

如果用户刚改过节点，前端通常还会先同步一次 draft，再发起运行请求。

这一阶段本质上是在使用 `Graph Definition`，还没有真正开始图执行。

相关入口：

- `references/dify/web/app/components/workflow-app/hooks/use-workflow-init.ts`
- `references/dify/web/app/components/workflow-app/hooks/use-nodes-sync-draft.ts`
- `references/dify/web/app/components/workflow-app/hooks/use-workflow-run.ts`

## 3.2 请求进入 AppGenerateService

不管请求来自哪里：

- console debugger
- web app
- service API

最后都会进入：

- `references/dify/api/services/app_generate_service.py`

这里先做的是 Dify 自己的产品级调度，而不是 graphon 的图调度：

- 预留 quota
- app 级 rate limit
- 根据 `AppMode` 分发
- 判断 `streaming` 还是 `blocking`

对 workflow 来说，最重要的是：

- `AppMode.WORKFLOW`
- `AppMode.ADVANCED_CHAT`

这两个分支最后都会进入 workflow-based generator。

## 3.3 决定 streaming 还是 blocking

这里 Dify 会分成两条路。

### A. Streaming

如果是 streaming：

1. 构造 `AppExecutionParams`
2. 客户端先订阅事件流
3. 通过 Celery 任务启动真正执行

对应实现：

- `workflow_based_app_execution_task.delay(payload_json)`

也就是说，前端不是直接挂在执行线程上，而是订阅后续的事件流。

### B. Blocking

如果是 blocking：

1. 不进 Celery
2. 直接同步调用 `WorkflowAppGenerator().generate(...)`

这种模式更接近“当前请求里同步跑完，然后直接返回结果”。

## 3.4 WorkflowAppGenerator 组装应用级上下文

不管是 blocking 还是 streaming，真正进入 workflow 执行包装层后，都会经过：

- `references/dify/api/core/app/apps/workflow/app_generator.py`

这一层做的不是底层图调度，而是 Dify 的“应用级封装”：

- 解析文件输入
- 预处理用户输入
- 读取 app config
- 创建 trace manager
- 创建 workflow execution repository
- 创建 workflow node execution repository
- 创建 queue manager
- 可选挂上 `PauseStatePersistenceLayer`

然后它会启动 worker thread，把更底层的图执行交给 `WorkflowAppRunner`。

所以这一层的职责是：

**把“Dify 应用请求”翻译成“可执行的 workflow run 上下文”**

## 3.5 WorkflowAppRunner 初始化 Graph Runtime State

真正进入运行态装配的是：

- `references/dify/api/core/app/apps/workflow/app_runner.py`

这里开始初始化核心 runtime state：

1. 创建 `VariablePool`
2. 注入 system variables
3. 注入 environment variables
4. 把 start node inputs 写入变量池
5. 创建 `GraphRuntimeState`
6. 解析 root node
7. 初始化 graph
8. 创建 Redis command channel
9. 构造 `WorkflowEntry`

所以如果只看“图运行状态从哪里开始建立”，答案就在这里：

- `VariablePool`
- `GraphRuntimeState`

这就是 Dify 一次 run 的内存运行态起点。

## 3.6 WorkflowEntry 创建 Graph Runtime Engine

接下来进入：

- `references/dify/api/core/workflow/workflow_entry.py`

这里会直接创建：

- `GraphEngine`

同时挂上若干 layer：

- `ExecutionLimitsLayer`
- `LLMQuotaLayer`
- `ObservabilityLayer`
- `DebugLoggingLayer`

也就是从这里开始，真正的 **Graph Runtime Engine** 启动。

这一步之后，workflow 就不再只是“配置 + 状态”，而是进入真正的图调度执行。

## 3.7 节点体系如何接上引擎

图引擎只知道要执行节点，但节点类型本身需要注册。

在 Dify 里，这件事由：

- `references/dify/api/core/workflow/node_factory.py`

负责。

它会同时加载：

- `graphon.nodes`
- `core.workflow.nodes`

所以节点来源有两部分：

1. graphon 提供的通用节点能力
2. Dify 自己补充的 workflow 节点与 runtime adapter

这也是 Dify 和 graphon 的边界所在：

- graphon 负责通用图能力
- Dify 负责 AI 应用平台相关节点和适配

## 3.8 运行中如何持续输出状态

图开始执行之后，Dify 不会等整张图全部跑完才返回。

它会不断产出事件，比如：

- workflow started
- node started
- node finished
- text chunk
- workflow paused
- workflow failed

如果是 streaming，这些事件会通过 Redis topic 和 SSE 持续送到客户端。

如果客户端断线或后来再连，Dify 会通过：

- workflow run
- node execution snapshot
- pause state

先构造一份历史快照事件，再接上实时流。

对应实现：

- `references/dify/api/services/workflow_event_snapshot_service.py`
- `references/dify/api/core/app/apps/message_generator.py`
- `references/dify/api/tasks/app_generate/workflow_execute_task.py`

所以 Dify 的 runtime 不只是“会跑图”，还包含一整套：

- 事件流输出
- 状态回放
- 暂停恢复
- 断线重连

## 4. 一条最短总结链

如果你只想记住一条最短链路，可以记这个：

`Workflow.graph`
-> `AppGenerateService`
-> `WorkflowAppGenerator`
-> `WorkflowAppRunner`
-> `GraphRuntimeState / VariablePool`
-> `WorkflowEntry`
-> `graphon.GraphEngine`
-> `事件流 + 持久化`

其中：

- 前半段是 Dify 的应用层封装
- 中间两步是 runtime state 初始化
- 真正跑图的是 `graphon.GraphEngine`

## 5. 最后一句话

在 Dify 里，workflow 并不是直接“由 graphon 全包”。

更准确地说是：

- **Dify 定义图**
- **Dify 组装应用上下文和持久化状态**
- **graphon 负责底层图执行**

这就是 Dify 里三层的真正分工。

## 6. 常见运行时概念在 Dify 里分别是什么意思

前面讲的是三层结构。下面把几个常见 runtime 概念，直接映射到 Dify 的真实实现。

### 6.1 变量池

变量池就是一次 workflow run 的运行时变量上下文。

它不是 workflow 定义本身，也不是数据库里的历史记录，而是当前这次执行在内存里的变量空间。

在 Dify 里，变量池主要由 `VariablePool` 承担。workflow 启动时会先把这些内容注入进去：

- system variables
- environment variables
- root node inputs

后续节点再继续从里面取值、写值。

对应实现：

- `references/dify/api/core/app/apps/workflow/app_runner.py`
- `references/dify/api/core/workflow/variable_pool_initializer.py`

它的关键特点是：

- 变量按 selector 存储
- 常见形式类似 `(node_id, key)`
- 下游节点不是直接吃上游函数返回值，而是通过 selector 去取变量

### 6.2 当前执行状态

当前执行状态不是单一对象，而是两层一起组成：

1. 内存里的 `GraphRuntimeState`
2. 持久化的 workflow run / node execution / pause state

其中：

- `GraphRuntimeState` 负责执行中的即时状态
- 持久化记录负责 run history、断线恢复、pause / resume、事件回放

所以 Dify 的“当前执行状态”不能只理解成一个内存对象，也不能只理解成数据库表。

更准确地说，它是：

**GraphRuntimeState + 持久化执行状态**

### 6.3 节点输出到下游节点的传递

Dify 不是沿着 edge 直接传一个临时 payload 给下游节点。

它更像：

1. 当前节点产生 `NodeRunResult(outputs=...)`
2. 输出进入 runtime 上下文
3. 下游节点按 selector 从变量池读取自己依赖的值

所以它的核心传递机制不是“函数参数传递”，而是：

**变量池 + selector 引用**

这也是 graph 形式和线性 phase 形式的一个关键差别。

### 6.4 事件流

事件流是运行过程的观察通道。

它不是 workflow 真正执行逻辑的一部分，而是把执行过程中的状态变化持续推给客户端，例如：

- workflow started
- node started
- node finished
- workflow paused
- workflow failed

Dify 的事件流有两个特点：

1. live 事件持续推送
2. 断线后可以先回放 snapshot，再接 live 流

也就是说，Dify 不是“只做直播”，它还做了“补历史”。

对应实现：

- `references/dify/api/services/workflow_event_snapshot_service.py`
- `references/dify/api/tasks/app_generate/workflow_execute_task.py`
- `references/dify/api/core/app/apps/message_generator.py`

### 6.5 pause / resume

在 Dify 里，pause 不是简单地把某个线程挂住。

它的本质是：

1. workflow 收到 pause 事件
2. 把当前 `graph_runtime_state` 序列化
3. 连同 `generate_entity` 和 `pause_reasons` 一起落库
4. 后面再把这份 snapshot 重新加载回来继续执行

所以 Dify 的 pause / resume 是：

**可恢复执行状态持久化**

不是纯内存暂停。

对应实现：

- `references/dify/api/core/app/layers/pause_state_persist_layer.py`
- `references/dify/api/tasks/app_generate/workflow_execute_task.py`
- `references/dify/api/services/human_input_service.py`

### 6.6 command channel

command channel 是控制通道，不是数据通道。

它的作用是让外部或 layer 在 workflow 运行中发控制命令给 `GraphEngine`，例如：

- `PAUSE`
- `ABORT`

在 Dify 的真实 workflow run 里，这个 channel 通常是 Redis channel，key 形如：

- `workflow:{task_id}:commands`

对应实现：

- `references/dify/api/core/app/apps/workflow/app_runner.py`
- `references/dify/api/core/workflow/workflow_entry.py`
- `references/dify/api/core/app/workflow/layers/llm_quota.py`
- `references/dify/api/core/app/layers/timeslice_layer.py`

如果把上面六个概念压缩成一句话，可以记成：

- `变量池` 是数据面
- `当前执行状态` 是 runtime 状态面
- `事件流` 是观察面
- `command channel` 是控制面
- `pause / resume` 是可恢复执行面
- `节点输出传递` 是基于 selector 的变量引用传递

## 7. 这种 graph 形式适不适合当前这个 app

先说结论：

**适合做你这个 app 的下一阶段能力底座，但不适合直接原样替换你现在这套 workflow。**

原因不是 Dify/graphon 不够强，而是你当前 app 的 workflow 形态和 Dify 的目标形态还不是一类系统。

### 7.1 你当前 app 更像什么

你现在这套 workflow，本质上更接近：

- 有序 phase pipeline
- 每个 phase 有明确类型：`auto` / `checkpoint`
- phase 之间主要通过文件输出和状态文件衔接
- 人工暂停、回退、重跑是产品主路径
- runtime state 目前以本地 `workflow-state.json` 和 phase 文件为主

对应实现：

- `packages/core-models/workflow.mjs`
- `packages/core-models/state.mjs`
- `apps/desktop/electron/workflow-runtime.mjs`

它的核心优势是：

- 简单
- 可读
- 很贴合 desktop-first、本地文件可见、任务制工作流

### 7.2 Dify/graphon 这种 graph 形式更适合什么

这种 graph runtime 更适合：

- 节点类型持续扩张
- 分支逻辑越来越多
- 节点依赖不再只是严格线性顺序
- 需要 loop、child graph、trigger、tool node、human input node 统一建模
- 需要更强的运行时可控性和事件系统

也就是说，它更适合“流程编排平台”，不只是“按阶段推进的任务流”。

### 7.3 为什么不适合直接替换你当前实现

因为你当前 app 的主模型还是 phase，不是任意 graph。

你现在很多能力都建立在 phase 语义上：

- phase 顺序
- checkpoint 审核
- reject target
- phase 内容文件
- phase artifact
- phase sessionId
- worktree 生命周期

这些语义现在都直接写进了状态结构和 runtime 行为里。

如果直接改成 Dify/graphon 这种通用 graph：

1. 现有产品语义会先被打散
2. 需要重新定义 phase 和 graph node 的对应关系
3. 本地文件、artifact、manual checkpoint、worktree 这些能力都要重新接入 runtime

这会明显放大改造面。

### 7.4 更现实的建议

更合理的路线不是“立刻把 phase runtime 换成 graph runtime”，而是分两步：

1. 先保留 phase 作为产品层模型
2. 只在 runtime 层逐步吸收 graph 的能力

例如先引入这些能力，而不是先引入完整自由图：

- phase 级变量池
- 更标准化的事件流
- pause snapshot / resume snapshot
- command channel
- 非线性跳转能力
- 局部 loop / 子流程

这样做的好处是：

- 不破坏当前 app 的 phase UX
- 可以继续保留本地文件和 worktree 语义
- runtime 能逐步从“线性 phase engine”升级到“受控 graph engine”

### 7.5 我对你当前 app 的判断

如果你的目标还是：

- desktop-first
- task/worktree 驱动
- 人工审阅和回退很重要
- workflow 主要是固定阶段编排

那么当前阶段最合适的不是 Dify 这种自由 graph editor。

更合适的是：

**保留 phase-first 的产品模型，按 graph runtime 的思路增强执行层。**

如果未来你的目标变成：

- 用户自己拖拽节点
- 自定义分支和循环越来越多
- workflow 不再主要按固定 phase 理解

那时再把底层逐步演进成真正的 graph runtime，会更顺。
