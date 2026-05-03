# TODO: App Memory System

## Background

当前这个 APP 在每次与代码库协作、执行 workflow 的过程中，会产生大量聊天记录、代码改动、报错信息、命令输出，以及结构化或非结构化结果。

这些内容本质上都承载了用户经验、项目经验和 AI 协作经验，但目前还没有被系统化沉淀，也无法在下一次任务开始时复用。

## Goal

给 APP 增加一套“记忆系统”，把历史协作过程中有价值的经验沉淀下来，并在后续 AI 交互中按需带回，减少重复犯错，提高上下文连续性。

## What Can Be Remembered

- 用户与 AI 的聊天记录
- workflow 的输入、输出和中间结果
- 生成或修改过的代码
- 报错、修复过程和最终解决方案
- 项目约束、代码风格和用户偏好

## Memory Layers

建议至少分层处理，而不是只做一个统一的大仓库：

- 会话记忆：当前对话内的短期上下文
- workflow 记忆：一次 workflow 完成后的总结和经验
- 项目记忆：长期有效的仓库规则、架构知识和常见坑
- 用户记忆：用户偏好、协作习惯和明确要求

后续也可以继续细分：

- 错误记忆：历史 bug、报错模式和修复路径
- 决策记忆：为什么当时选某个方案，没有选另一个方案

## Proposed Approach

- 不直接把所有原始聊天和代码全文都喂给模型
- 原始记录保留为日志
- 从日志中提炼出可复用的经验卡片
- 新任务开始时，只检索并注入最相关的少量记忆

## Suggested Memory Record Shape

每条记忆可以考虑包含这些字段：

- type：如 `workflow-summary`、`bug`、`preference`、`architecture`
- scope：如 `session`、`workflow`、`project`、`user`
- content：提炼后的经验内容
- evidence：来源对话、日志、代码 diff 或任务记录
- confidence：置信度
- updatedAt：最近更新时间
- expiresAt：可选过期时间

## Real Module Diagram For This Repo

下面这张图不是泛化方案，而是按当前仓库已有模块整理出来的接入方式。

```text
┌──────────────────────────────────────────────────────────────────────┐
│                           apps/desktop/renderer                      │
│ React UI                                                            │
│ - 发起聊天、开始 workflow、展示任务状态                             │
│ - 展示记忆摘要、错误提醒、历史 workflow 经验                         │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ IPC / HTTP / WS
                                v
┌──────────────────────────────────────────────────────────────────────┐
│                    apps/desktop/electron + local server             │
│                                                                      │
│ apps/desktop/electron/workflow-runtime.mjs                           │
│ - 执行 workflow phase                                                 │
│ - 产生 phase 内容、artifact、状态变化                                │
│                                                                      │
│ apps/desktop/local-server-controllers/                               │
│ - workflowController.mjs                                              │
│ - wsController.mjs                                                    │
│ - 对 renderer / connector 暴露本地 API 和 WS                         │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ 采集 chat / state / artifact / diff / error
                                v
┌──────────────────────────────────────────────────────────────────────┐
│                    Memory Capture + Extract Layer                    │
│                建议新增在 apps/desktop 或 packages/core-lib          │
│                                                                      │
│ 1. Event Capture                                                      │
│ - 监听 workflow 状态变更                                              │
│ - 记录聊天消息、phase 文件、artifact、命令输出、错误                  │
│                                                                      │
│ 2. Memory Extractor                                                   │
│ - 从原始记录提炼 workflow_summary / bug / preference / rule           │
│ - 给记忆打标签、scope、confidence                                     │
└──────────────────────┬───────────────────────────┬───────────────────┘
                       │                           │
                       │ 原始记录                   │ 提炼后的记忆
                       v                           v
┌────────────────────────────────┐     ┌────────────────────────────────┐
│ Local Evidence Store           │     │ Local Memory Store             │
│ 建议: SQLite                   │     │ 建议: SQLite                   │
│                                │     │                                │
│ - chat_sessions                │     │ - memory_entries               │
│ - chat_messages                │     │ - memory_links                 │
│ - workflow_runs                │     │ - memory_feedback              │
│ - workflow_steps               │     │                                │
│ - artifacts                    │     │ type:                          │
│ - file_changes                 │     │ - workflow_summary             │
│ - error_events                 │     │ - bug                          │
│ - command_logs                 │     │ - project_rule                 │
└──────────────────────┬─────────┘     │ - preference                   │
                       │               │ - decision                     │
                       │               └────────────────┬───────────────┘
                       │                                │
                       v                                v
┌──────────────────────────────────────────────────────────────────────┐
│                         Retrieval / Recall Layer                     │
│                                                                      │
│ - SQLite FTS5: 关键词、文件名、错误码、workflow 名称精确检索         │
│ - sqlite-vec 或 LanceDB: 语义相似记忆召回                            │
│ - 规则过滤: 只取当前项目 / 当前 workflow / 当前用户相关内容           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                │ 注入相关记忆
                                v
┌──────────────────────────────────────────────────────────────────────┐
│                   AI Prompt Builder / Runtime Context                │
│                                                                      │
│ - 固定注入: 用户偏好 / 项目规则 / 高置信长期记忆                      │
│ - 动态召回: 与当前任务最相关的 workflow 经验和错误记忆                │
│ - 错误预警: 类似任务以前失败过什么                                   │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
                                v
┌──────────────────────────────────────────────────────────────────────┐
│                 packages/core-lib/claude.mjs / AI runtime           │
│ - 用补充后的上下文继续执行当前任务                                    │
└──────────────────────────────────────────────────────────────────────┘


可选远程同步层：

apps/desktop/connector/src/index.mjs
        │
        v
apps/backend/src/server.mjs
        │
        v
apps/mobile

- 第一阶段不建议把完整记忆系统直接做成 cloud-first
- 更适合先在 desktop 本地落盘和召回
- 后续只同步“筛选后的记忆卡片”和必要索引给 backend / mobile
```

## Write Path

建议写入流程按下面这条链路走：

```text
Renderer / Electron / Local Server 产生事件
  -> Event Capture 记录原始证据
  -> 写入 SQLite 原始表
  -> workflow 完成或达到阈值后触发 Memory Extractor
  -> 提炼成结构化记忆卡片
  -> 写入 memory_entries
  -> 同步更新 FTS / 向量索引
```

这个写法有两个好处：

- 原始证据和提炼记忆分开，后面更容易 debug
- 未来如果提炼策略变了，可以重新从原始记录回放生成记忆

## Read Path

建议读取流程按下面这条链路走：

```text
用户发起新任务
  -> 读取当前项目、workflow、目标文件、用户输入
  -> 先取固定记忆
     - 用户偏好
     - 项目规则
     - 高置信长期记忆
  -> 再做动态检索
     - 最近 workflow summary
     - 相似 bug / fix pattern
     - 相关架构说明
  -> 将少量高相关结果注入 AI 上下文
  -> 开始执行当前任务
```

## Why Memory Needs Layers

之所以要分层，不是为了设计好看，而是因为不同信息的生命周期完全不一样：

- 会话记忆变化最快，只对当前任务有用
- workflow 记忆适合沉淀一次任务的经验
- 项目记忆相对稳定，适合长期复用
- 用户记忆是跨任务存在的偏好
- 错误记忆最适合做风险预警，减少重复踩坑

如果不分层，常见问题会很快出现：

- 所有聊天都塞进长期记忆，噪音太大
- 临时讨论和长期规则混在一起
- 旧任务结论覆盖新项目事实
- 检索时拿回来一堆不该注入的内容

## Storage Recommendation

结合当前项目形态，我建议这样选：

- 第一阶段：
  - 原始记录库：`SQLite`
  - 结构化记忆库：`SQLite`
  - 全文检索：`FTS5`
  - 向量检索：`sqlite-vec` 或 `LanceDB`

- 第二阶段：
  - backend 增加 `Postgres + pgvector`
  - connector 只同步已筛选的记忆卡片
  - mobile 端主要消费 summary 和提醒，不直接承担完整记忆库

原因很直接：

- 这个仓库当前是 desktop-centered
- workflow runtime、本地 server、connector 都已经是本地优先结构
- 先做本地记忆最容易接进现有链路，也最容易验证效果

## Risks

- 错误结论被写入记忆，污染后续结果
- 同一经验重复存储，导致检索噪音过多
- 项目已经变化，但旧记忆仍然被引用

## MVP

第一阶段建议只做最小可用版本：

- 每次 workflow 结束后自动生成一张总结卡片
- 内容包括：做了什么、改了什么、遇到了什么问题、怎么解决、下次要注意什么
- 新任务开始时，按当前项目和任务关键词检索相关卡片
- 将检索结果作为附加上下文注入给 AI

## Out Of Scope For Now

- 不在第一阶段做全量原始数据长期注入
- 不在第一阶段做复杂知识图谱
- 不在第一阶段做跨项目经验迁移
- 不在第一阶段做完全自动的高置信度长期记忆裁决
