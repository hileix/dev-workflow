# Dify workflow 与整体架构分析

基于本地源码仓库 `references/dify` 分析，版本为 `90fe54c`，远端为 `https://github.com/langgenius/dify.git`。

## 1. 先说结论

Dify 不是一个“只有 workflow 引擎”的项目，而是一个围绕 AI 应用开发平台展开的完整产品仓库。它把真正通用的图执行能力尽量下沉到外部依赖 `graphon`，而把 Dify 自己的工作重点放在四层：

1. 应用层：Workflow App、Advanced Chat、Agent Chat、Completion 等产品形态。
2. 平台层：模型接入、知识库、工具、插件、配额、鉴权、观测、协作。
3. 运行层：工作流执行、事件流、暂停/恢复、人类输入、单节点调试。
4. 交付层：Web 控制台、公开 API、自托管 Docker、可裁剪 provider 插件体系。

这决定了它的架构不是“前端 + 一个简单后端”，而是“控制台 + API 服务 + 异步任务系统 + Redis 事件通道 + 可插拔 runtime/provider”。

## 2. 仓库分层

### 2.1 顶层模块

- `api/`：Python 后端，基于 Flask，承担 API、工作流运行、模型/工具/知识库接入、Celery 任务、Socket.IO 协作。
- `web/`：Next.js 前端控制台，工作流编辑器、调试面板、应用管理 UI 都在这里。
- `packages/`：前端共享包，比如 `@dify/contracts` 和 `@langgenius/dify-ui`。
- `docker/`：官方自托管部署入口，包含 API、Web、Redis、数据库、向量库等运行所需配置。
- `sdks/`：面向外部集成方的 SDK。
- `api/providers/`：可插拔 provider，尤其是向量库和 trace provider。

从 workspace 角度看，前端 monorepo 由 `pnpm-workspace.yaml` 管理 `web`、`e2e`、`sdks/nodejs-client`、`packages/*`；后端 Python 则在 `api/pyproject.toml` 里用 `uv workspace` 管理 `providers/vdb/*` 和 `providers/trace/*`。

### 2.2 后端启动骨架

`api/app.py` 是 API 进程入口，它创建 Flask app，并包上一层 gevent WebSocket server；`create_app()` 在 `api/app_factory.py` 中初始化数据库、Redis、Celery、蓝图、OpenTelemetry、Socket.IO 等扩展，最后把 Flask app 包成 `socketio.WSGIApp`。

这说明 Dify 的后端从一开始就不是“纯 HTTP API”，而是同时包含：

- 普通 REST API
- SSE 流式返回
- Socket.IO 协作连接
- Celery 异步执行

## 3. Workflow 的核心数据设计

### 3.1 Workflow 其实是一份 DSL 文档

`api/models/workflow.py` 里的 `Workflow` 模型是整个 workflow 系统的核心持久化对象。它直接把这些东西存进数据库：

- `graph`：整个画布 DSL，JSON 字符串，包含 nodes、edges、viewport。
- `features`：工作流级功能配置。
- `environment_variables`
- `conversation_variables`
- `rag_pipeline_variables`
- `version`：`draft` 或发布版本号。

这说明 Dify 的 workflow 设计本质上是“画布 DSL 驱动”，而不是把每个节点、每条边拆成强关系表。这样的好处是：

- 前端 React Flow 结构可以直接落库。
- 发布版本可以做整份快照复制。
- 节点 schema 迭代更灵活。

代价也很明确：

- 图结构校验更多依赖运行前校验，不依赖数据库约束。
- JSON 读写频繁，强类型边界不如关系模型硬。

### 3.2 Draft / Published 双轨

`api/services/workflow_service.py` 里，草稿通过 `sync_draft_workflow()` 更新，发布通过 `publish_workflow()` 复制出一个新版本。

这里有几个关键点：

1. 草稿只有一份：`version == "draft"`。
2. 发布不是原地改，而是复制草稿生成新版本快照。
3. 草稿同步带 `hash`，用于乐观并发控制，避免多人或多标签页互相覆盖。

这套模型非常产品化。它优先保证：

- 编辑态可以频繁保存
- 运行态可以绑定已发布版本
- 历史版本可以回放、恢复、审计

而不是只追求“图执行最快”。

## 4. Workflow 编辑器的前端设计

### 4.1 画布与本地状态

工作流页面入口非常薄：`web/app/(commonLayout)/app/(appDetailLayout)/[appId]/workflow/page.tsx` 直接挂载 `WorkflowApp`。

真正的编辑器壳在 `web/app/components/workflow-app/index.tsx`，负责：

- 初始化 workflow draft
- 拉取默认节点配置和已发布版本
- 将后端 graph 转成 React Flow 的 nodes/edges
- 注入 workflow store、features store、trigger 状态

底层画布组件在 `web/app/components/workflow/index.tsx`，核心技术栈是：

- `reactflow`：节点/边/viewport 画布
- store：保存节点运行态、面板状态、变量、同步 hash 等
- features provider：保存 opening、tts、moderation、file upload 等工作流级能力

### 4.2 草稿同步

`useWorkflowInit()` 启动时请求 `/apps/:id/workflows/draft`，拿到 graph、features、环境变量、会话变量；如果草稿不存在，会自动创建初始化草稿。

`useNodesSyncDraft()` 负责把当前 nodes、edges、viewport、features、variables 序列化后发回 `/apps/:id/workflows/draft`。它会：

- 过滤前端临时字段
- 带上 `syncWorkflowDraftHash`
- 在协作模式下区分 leader / follower
- 页面关闭时用 keepalive 补最后一次同步

这说明 Dify 的画布不是“本地状态优先、手动保存”，而是“近实时草稿同步”。

### 4.3 调试与运行入口

`useWorkflowRun()` 在运行前会先 `doSyncWorkflowDraft()`，然后发起 SSE 请求执行 draft workflow。它同时支持：

- 整体运行
- iteration 单节点运行
- loop 单节点运行
- trigger debug
- stop run

这体现了 Dify workflow 编辑器的一个明显定位：它不是只负责“配置”，而是把“开发态调试器”直接嵌在画布里。

## 5. Workflow 运行链路

### 5.1 控制台 / API 入口

后端控制器有三类：

- `controllers/console/app/workflow.py`：控制台草稿编辑、运行、单节点调试、人类输入表单预览。
- `controllers/web/workflow.py`：面向 Dify 自己 Web App 的公开运行入口。
- `controllers/service_api/app/workflow.py`：对外 API，支持 blocking / streaming 两种模式。

这三类入口最后都会汇入 `services/app_generate_service.py`。

### 5.2 统一分发器：AppGenerateService

`AppGenerateService.generate()` 是 Dify 多种 app mode 的总调度器。它先做：

- 配额预留
- app 级并发限流
- 根据 `AppMode` 分发到不同 generator

对 workflow 来说：

- `AppMode.WORKFLOW`
- `AppMode.ADVANCED_CHAT`

这两条都会走 workflow-based generator，而不是传统 chat/completion 管线。

### 5.3 Streaming 与 Blocking 两条执行路径

在 workflow 模式下，`AppGenerateService` 明确区分两种运行方式：

1. `streaming=true`
   把执行参数打包成 `AppExecutionParams`，通过 `workflow_based_app_execution_task.delay()` 扔到 Celery；前端先订阅事件流，后端异步推送事件。
2. `streaming=false`
   直接同步调用 `WorkflowAppGenerator().generate(...)`，返回阻塞式结果。

这点很关键。Dify 并不是“所有 workflow 都异步队列化”，而是：

- 面向交互式调试和 UI 预览时，可以同步跑
- 面向正式流式运行时，走 Celery + Redis 事件通道

### 5.4 Celery worker 中真正的执行

Celery 任务定义在 `api/tasks/app_generate/workflow_execute_task.py`。

它的职责是：

1. 反序列化 `AppExecutionParams`
2. 重新加载 `App`、`Workflow`、`User`
3. 构造 `PauseStateLayerConfig`
4. 调用 `WorkflowAppGenerator().generate(...)`
5. 如果是 streaming，就把事件发布到 Redis topic

也就是说，SSE 客户端并不直接“盯住执行线程”，而是订阅一个 Redis topic。这样做有两个实际好处：

- Web 请求和执行进程彻底解耦
- 前端断线后可以走“事件重建 / resume”逻辑

### 5.5 WorkflowAppGenerator：应用态包装器

`api/core/app/apps/workflow/app_generator.py` 负责把“工作流引擎执行”包装成 Dify 应用运行。

它做的事情包括：

- 解析文件输入
- 读取 app config
- 预处理用户输入
- 创建 trace manager
- 构建 workflow execution repository / node execution repository
- 创建 queue manager
- 挂 PauseStatePersistenceLayer
- 启动后台 worker thread
- 把内部事件转换成 blocking 响应或 stream 响应

这里能看出一个典型分层：

- `WorkflowAppGenerator` 不直接实现图执行
- 它负责“应用级上下文、仓储、队列、响应协议”
- 真正的图执行交给下游 runner + graph engine

### 5.6 WorkflowAppRunner：运行时装配层

`api/core/app/apps/workflow/app_runner.py` 才真正把工作流跑起来。它会：

1. 初始化 `VariablePool`
2. 注入 system variables、environment variables、start node inputs
3. 根据 graph config 找 root node
4. 创建 `GraphRuntimeState`
5. 初始化 graph
6. 创建 Redis command channel：`workflow:{task_id}:commands`
7. 构造 `WorkflowEntry`
8. 挂 `WorkflowPersistenceLayer` 和其他 graph layers
9. 遍历 `workflow_entry.run()` 产生的事件

这里能看出 Dify 的 workflow runtime 是由几块拼起来的：

- graph config
- variable pool
- runtime state
- command channel
- persistence layer
- observability / quota / limits layers

### 5.7 WorkflowEntry：图执行入口

`api/core/workflow/workflow_entry.py` 是 Dify 接到 `graphon` 的那一层。

它做的事情很明确：

- 创建 `GraphEngine`
- 配置 worker 数量、伸缩阈值、超时限制
- 挂 `ExecutionLimitsLayer`
- 挂 `LLMQuotaLayer`
- 在 OTel 开启时挂 `ObservabilityLayer`
- 需要时挂 `DebugLoggingLayer`
- 支持 child graph builder

这里最重要的事实是：Dify 没有自己重新发明一套并行图执行引擎，而是把这块能力交给 `graphon`，自己负责 layer、node、runtime adapter 和平台集成。

### 5.8 Node 注册与 Dify 适配

`api/core/workflow/node_factory.py` 说明了节点体系的设计：

- 先加载 `graphon.nodes`
- 再加载 `core.workflow.nodes`
- 两者共同注册到 Node registry

这意味着：

- 通用节点能力尽量来自 `graphon`
- Dify 自己只补“产品相关节点”或对 runtime 的适配

同时 `DifyNodeFactory` 还负责把这些 Dify 特有能力塞进节点运行时：

- 模型访问
- 工具运行
- 文件管理
- Human Input runtime
- Prompt serializer
- Code executor

## 6. Pause / Resume / Human Input 设计

这是 Dify workflow 里很重要，也很像产品平台而不是纯引擎的部分。

### 6.1 Pause 状态持久化

在 blocking 路径和 worker 路径里，都会给 workflow execution 挂 `PauseStatePersistenceLayer`。这代表暂停不是只停在内存里，而是落库持久化。

### 6.2 事件流重建

`api/services/workflow_event_snapshot_service.py` 在客户端重连或 resume 时，会：

- 读取 `WorkflowRun`
- 读取 `WorkflowPause`
- 读取 node execution snapshots
- 先构造 workflow_started / node_started / node_finished 的快照事件
- 再接上 Redis topic 的实时事件

这说明 Dify 的 resume 不是简单“从头重放”，也不是只靠内存缓存，而是“数据库快照 + Redis 实时流”的拼接模型。

### 6.3 Human Input

控制台里专门提供了 human input form preview / run 接口，相关逻辑在：

- `controllers/console/app/workflow.py`
- `services/workflow_service.py`

这表明 Human Input 在 Dify 里不是普通节点配置，而是带完整交互闭环的暂停点：

- 先生成表单
- 用户提交表单
- workflow 继续执行

这个设计对真实业务流程更实用，因为很多 AI workflow 需要人工审批、确认、补录。

## 7. 协作模式设计

协作不是简单“共享草稿”，而是单独的一套实时系统。

### 7.1 前端协作

`web/app/components/workflow/collaboration/core/collaboration-manager.ts` 使用：

- `loro-crdt`
- `socket.io-client`

来同步 graph 变更、光标、评论、节点面板状态等。

### 7.2 后端协作

Socket.IO 入口在 `api/controllers/console/socketio/workflow.py`，服务层在 `api/services/workflow_collaboration_service.py`。

它的核心策略不是人人同时直接写库，而是：

- 先基于 token 鉴权
- 加入 workflow room
- 维护在线用户列表
- 选举一个 leader
- follower 需要同步时向 leader 发 `sync_request`
- graph_update / collaboration_update 通过 room 广播

这套设计的重点不是“绝对强一致”，而是降低多人同时编辑 React Flow 画布时的冲突复杂度。CRDT 负责结构同步，leader/follower 负责把草稿持久化行为收敛到更少的写入源。

## 8. Provider 与可扩展性设计

### 8.1 后端 provider 插件化

`api/providers/README.md` 和 `api/providers/vdb/README.md` 说明，Dify 把不少“外部系统接入”做成独立 workspace package：

- 向量库 provider
- trace provider

通过 `entry_points` 动态发现，在运行时装载。

这背后的思路很清楚：

- 核心平台保持稳定
- 第三方依赖分散到 provider
- 自托管发行版可以裁剪 provider 集合

### 8.2 前端 contracts 与 UI 共享包

前端 monorepo 里：

- `packages/contracts`：由后端 OpenAPI 生成 TS contract
- `packages/dify-ui`：共享 UI primitives

这说明 Dify 在前端并不把所有东西都塞进 `web/`，而是已经开始把 API 合约和设计系统抽离成可复用包。

## 9. Dify 的 workflow 设计理念

从源码看，Dify 的 workflow 设计理念可以概括成下面几点。

### 9.1 Workflow 是 AI 应用编排层，不是底层引擎本身

真正的图执行能力交给 `graphon`；Dify 自己负责产品语义、节点生态、模型与工具接入、运行记录、调试、协作。

### 9.2 DSL 优先于关系建模

画布 JSON 直接作为权威数据结构。这样前后端围绕同一份 DSL 工作，换来开发效率和产品迭代速度。

### 9.3 运行时和交互态都很重要

它不只关心“最后跑完”。源码里大量能力都围绕开发态和运行中体验：

- 单节点调试
- SSE 流式事件
- stop command
- pause / resume
- human input
- replay run

### 9.4 平台化优先于单点功能

无论是模型、向量库、trace，还是工具、插件、协作，Dify 都在往平台型产品走。workflow 只是平台的一个核心表面，不是全部。

### 9.5 自托管和云化同时兼容

Docker、Celery、Redis、Flask、Next.js 这套组合比较传统，但它的好处是部署面宽，容易 self-host，也能支持云上扩展。

## 10. 这套架构的优点与代价

### 优点

- 产品闭环完整：编辑、调试、运行、回放、恢复、协作都打通了。
- workflow 引擎与平台能力解耦得比较清楚。
- 自托管能力强，部署和裁剪空间大。
- streaming / blocking / resume 三种运行体验都覆盖。

### 代价

- 后端层级很多，初读成本高。
- `api/` 内责任偏重，controller/service/generator/runner/layer/repository 之间跳转比较多。
- graph JSON 方案灵活，但强类型和结构约束不如关系模型直观。
- 协作、暂停恢复、事件重建这些高级能力，让整体系统复杂度明显上升。

## 11. 对你这个仓库可借鉴的点

如果你想从 Dify 借鉴 workflow 设计，我认为最值得看的不是 UI，而是这几条：

1. 用一份统一 DSL 贯穿编辑、运行、版本化。
2. 把“图执行引擎”和“产品平台能力”明确分层。
3. 运行事件做成流，而不是只返回最终结果。
4. 从一开始就给 pause / resume / human input 留接口。
5. 协作持久化不要让所有客户端都直接争写后端。

如果你只是想借它的节点画布，那只学 React Flow 这一层价值不大；Dify 真正有参考价值的是“workflow 作为平台运行时”的那部分设计。
