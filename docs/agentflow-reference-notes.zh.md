# AgentFlow 可参考点

基于本地源码仓库 `references/agentflow` 分析。

## 1. 先说结论

`agentflow` 不是 LangGraph/LangChain 项目，而是一套自己实现的 agent workflow 编排工具。

它最值得参考的不是 UI，而是底层执行分层：

```text
Workflow Spec
  -> 校验和归一化
  -> Orchestrator 调度
  -> Agent Adapter 准备执行命令
  -> Runner 选择执行环境
  -> Event / Artifact / Trace Store 记录结果
```

对当前项目来说，可以把它当作一个轻量的 agent workflow runtime 参考，而不是完整产品 UI 参考。

## 2. AgentFlow 是什么

`agentflow` 用 Python DSL、YAML 或 JSON 定义 workflow，然后把 Codex、Claude、Kimi、Pi、Python、Shell 等节点组织成 DAG 执行。

它支持：

- DAG 依赖执行
- 并行 fanout
- merge 汇总
- review/fix 这类失败循环
- local、SSH、EC2、ECS 执行
- run、node、event、artifact、trace 记录
- Web UI 查看图和运行状态
- CLI 操作、校验、诊断、运行

它的 UI 更像运行监控面板，不是拖拽式 workflow builder。

## 3. 可以参考的点

### 3.1 Workflow definition 和 run state 分离

`agentflow` 把 pipeline 定义和运行结果分开：

- `PipelineSpec`：workflow 定义
- `RunRecord`：一次运行
- `NodeResult`：单个节点运行结果
- `RunEvent`：运行过程事件
- artifact/trace：节点产物和执行轨迹

当前项目也应该继续保持这个边界：

- workflow schema 是可编辑、可保存、可发布的定义
- run 是一次具体执行
- node result 是 run 下面的节点状态
- event log 用于恢复 UI、调试和审计
- artifact/trace 不应该塞进 workflow definition

这个分离会让历史运行、重跑、失败恢复、远程同步更清楚。

### 3.2 Spec -> Runtime 的边界

`agentflow` 先把 Python DSL/YAML/JSON 归一化成统一 spec，再交给 orchestrator。

当前项目可以参考这个思路：

```text
React Flow / UI draft
  -> workflow JSON schema
  -> validation / normalization
  -> runtime executable graph
```

UI 不应该直接驱动执行细节。UI 负责编辑，runtime 负责消费稳定 schema。

### 3.3 Agent Adapter 分层

`agentflow` 没有让 node 直接调用 Codex 或 Claude，而是通过 adapter 准备命令。

例如：

- Codex adapter 生成 `codex exec ...`
- Claude adapter 生成 `claude -p ...`
- Kimi/Pi adapter 处理各自参数和 provider 配置

当前项目可以参考这个边界：

```text
Workflow Node
  -> Agent Adapter
  -> Prepared Execution
```

这样以后接入不同 agent 时，不需要污染 workflow runtime：

- Codex CLI
- Claude Code CLI
- OpenAI API
- local model
- browser agent
- 自定义脚本节点

### 3.4 Runner 分层

`agentflow` 把“执行什么”和“在哪里执行”分开：

- Adapter：准备 agent 命令
- Runner：在 local、SSH、EC2、ECS 上执行命令

当前项目是 desktop-first，也可以保留类似抽象：

- local desktop runner
- connector runner
- remote machine runner
- cloud runner
- mobile 只触发和查看，不直接执行

这对后续支持远程设备、云端执行、桌面 relay 很有价值。

### 3.5 Event / Artifact / Trace 模型

`agentflow` 对每次执行保存事件和产物：

- run queued/running/completed/failed
- node started/completed/failed/retrying
- stdout/stderr
- trace
- output artifact

当前项目可以强化这类模型：

- 事件负责驱动 UI 实时状态
- artifact 负责保存大文本、diff、报告、图片、日志
- trace 负责调试 agent 行为
- run state 可以从事件和结果恢复

不要把所有东西都揉成一个大的 `workflow-state.json`。定义、运行状态、事件、产物最好分层保存。

### 3.6 Fanout / Merge

`agentflow` 的 fanout/merge 很适合 agent workflow。

可参考的场景：

- 多文件并行 code review
- 多个 agent 并行给方案
- 多个任务分片并行实现
- 多个 prompt 版本并行测试
- 汇总多个结果后生成 final answer

当前项目如果要做高级 workflow，可以把 fanout/merge 做成独立节点能力，而不是普通边的特殊 case。

### 3.7 Failure Loop

`agentflow` 支持类似：

```text
implement -> review
review failed -> implement
```

这对 coding agent 很重要。

当前项目可以支持这类模式：

- implement
- test
- review
- fix
- retry until passed or max iterations

但 UI 上要明确展示循环、最大次数和退出条件，避免用户配置出不可控 workflow。

### 3.8 Doctor / Preflight Check

`agentflow` 有 `doctor`、`check-local` 这类诊断能力，用来检查本地 agent、认证、shell、环境变量等。

当前项目也很适合做一套诊断：

- Codex CLI 是否安装
- Claude Code 是否安装
- API key 是否存在
- 本地 server 是否可达
- connector 是否在线
- backend relay 是否可连
- workspace 权限是否正常
- Git 状态是否可读

这会明显减少用户遇到“点了运行但不知道为什么失败”的情况。

## 4. 不建议直接照搬的点

### 4.1 不建议照搬 Python DSL

当前项目是 Electron、React、Node、TypeScript 体系，workflow 更适合用 JSON schema 和 TypeScript 类型建模。

Python DSL 对开发者友好，但不适合直接作为桌面产品的主要编辑格式。

### 4.2 不建议照搬 Web UI

`agentflow` UI 主要是监控和查看：

- 展示 graph
- 查看 run 历史
- 查看节点输出
- cancel/rerun

它不是完整 workflow editor。

当前项目如果要做产品化 workflow，应该继续走 React Flow 这类可视化编辑器，而不是参考它的 UI 结构。

### 4.3 不建议过早支持 EC2/ECS

`agentflow` 支持 EC2/ECS，但这会带来很多复杂度：

- AWS 认证
- 网络和安全组
- 镜像和安装脚本
- 成本控制
- 远程文件同步
- 失败清理

当前项目可以先把 local desktop runner 和 connector runner 做稳，再考虑 cloud runner。

## 5. 对当前项目的建议落点

短期可以参考：

1. 梳理 workflow definition、run record、node result、event、artifact 的边界。
2. 增加更明确的 agent adapter 层，避免 runtime 直接关心每个 agent 的调用细节。
3. 增加 runner 抽象，为 local/connector/remote 留边界。
4. 做一套 desktop preflight/doctor UI。
5. 在现有 LangGraph runtime 外围补强 artifact 和 trace 存储。

中期可以参考：

1. 支持 fanout/merge 节点。
2. 支持带最大次数的 failure loop。
3. 支持 run replay、rerun failed node、cancel node。
4. 支持 workflow run 的事件流回放。

长期可以参考：

1. remote runner。
2. cloud runner。
3. 多 agent 并行协作模板。
4. tuned agent 或 agent profile 的版本化管理。

## 6. 总结

`agentflow` 对当前项目最有参考价值的是 runtime 架构，而不是界面。

最核心的一点是：

```text
定义归定义，运行归运行；
agent 调用归 adapter；
执行环境归 runner；
过程记录归 event/artifact/trace store。
```

这个分层可以帮助当前项目在保留桌面优先体验的同时，把 workflow runtime 做得更稳定、更可扩展。
