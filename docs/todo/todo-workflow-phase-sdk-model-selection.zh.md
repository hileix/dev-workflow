# TODO: Workflow 阶段级 SDK 与 Model 选择

## Background

当前 workflow 编辑器里，自动阶段只有一个 `AI 后端` 选择项，本质上是按阶段选择运行时类型，例如 `claude` 或 `codex`。

这已经能区分不同阶段由哪个 AI runtime 执行，但还不够细。用户现在希望在编辑 workflow 时，不只是选择 SDK，还能针对每一个自动阶段继续选择对应的 model。这样不同步骤可以按任务特点分别配置：

- 更强的模型处理复杂步骤
- 更快或更便宜的模型处理简单步骤
- 同一个 workflow 内同时混用不同 SDK 和不同 model

## Goal

把当前“阶段只选 AI 后端”的能力，扩展为“阶段同时选择 SDK 和 model”。

目标是让 workflow 的每一个自动阶段都能独立决定：

- 使用哪个 SDK
- 使用该 SDK 下的哪个 model

## Assumption

- 配置粒度是 `phase`，不是整个 workflow 全局共享一套 SDK/model。
- 只有 `auto` 类型阶段需要配置 SDK 和 model。
- 本期先支持两个 SDK：
  - Claude Code SDK
  - Codex SDK
- 本期重点是 workflow 编辑、保存、展示和运行时配置传递的产品需求，不要求在这份文档里展开具体实现方案。

## Current State

当前状态大致如下：

- 自动阶段可以选择 `claude` 或 `codex`
- 这个选择只表达“由哪个 runtime 执行”
- 阶段没有独立的 `model` 配置
- 因此无法针对不同阶段做速度、成本、能力上的细分配置

## Requirement

### 1. 阶段级 SDK 选择

在 workflow 编辑器中，`auto` 阶段继续保留 AI 选择能力，但语义明确为 `SDK 选择`。

用户可以在每个自动阶段选择以下其一：

- Claude Code SDK
- Codex SDK

### 2. 阶段级 Model 选择

当用户为某个自动阶段选定 SDK 后，界面需要允许继续为该阶段选择 model。

要求如下：

- `model` 的配置粒度是单个 phase
- 不同 phase 可以配置不同 model
- 同一个 workflow 内允许同时存在：
  - 不同 SDK
  - 相同 SDK 下的不同 model
  - 不同 SDK 下的不同 model

### 3. SDK 与 Model 的关联关系

`model` 不是全局通用字段，而是依赖所选 SDK。

因此产品上需要满足：

- 当阶段选择 Claude Code SDK 时，只能选择 Claude Code SDK 支持的 model
- 当阶段选择 Codex SDK 时，只能选择 Codex SDK 支持的 model
- 当用户切换 SDK 时，如果原先已选 model 不属于新 SDK，可用以下任一策略，但产品行为必须明确且一致：
  - 清空该阶段的 model，要求用户重新选择
  - 自动切到该 SDK 的默认 model

建议优先采用“切换 SDK 后重置为该 SDK 默认 model”，这样编辑体验更顺。

### 4. Workflow 保存内容

workflow 中每个 `auto` 阶段最终都应保存至少以下信息：

- SDK 标识
- model 标识

语义上需要能明确表达：

- 这个阶段由哪个 SDK 执行
- 这个阶段执行时实际使用哪个 model

### 5. 运行时行为要求

当 workflow 运行到某个自动阶段时，运行时应使用该阶段保存下来的 SDK 和 model。

也就是说：

- 阶段 A 可以用 Claude Code SDK + model A
- 阶段 B 可以用 Codex SDK + model B
- 阶段 C 可以继续切回 Claude Code SDK + model C

运行时不应再被 workflow 级默认值覆盖，除非该阶段本身没有配置 model，且系统定义了明确的兼容默认值。

## UX Requirement

### 1. 编辑器展示

在 `auto` 阶段编辑区域，AI 配置建议拆成两个连续字段：

- SDK
- Model

推荐交互顺序：

1. 先选 SDK
2. 再选该 SDK 对应的 model

### 2. 可读性

用户在查看 workflow 时，应该能直观看到每个自动阶段使用的 AI 配置，而不只是看到 `claude` 或 `codex`。

至少需要让用户能区分：

- 这个阶段属于哪个 SDK
- 这个阶段具体用了哪个 model

### 3. 默认值

为减少配置成本，新建自动阶段时需要有默认值策略。

建议：

- 默认 SDK 沿用当前默认行为
- 默认 model 使用该 SDK 的默认 model

这样旧的使用习惯不会被完全打断。

## Validation Requirement

保存 workflow 时，需要满足以下校验规则：

- `auto` 阶段必须有 SDK
- `auto` 阶段必须有 model
- 所选 model 必须属于当前 SDK 的可用范围
- `checkpoint` 阶段不要求配置 SDK 和 model

如果校验失败，编辑器需要给出明确错误提示，不能保存出语义不完整的 workflow。

## Compatibility

### 1. 对已有 workflow 的兼容

仓库里已有 workflow 只有阶段级 `aiBackend`，没有阶段级 `model`。

因此需要兼容以下情况：

- 老 workflow 仍然可以被加载
- 老 workflow 在未立即补齐 model 前，不应该直接损坏或无法读取
- 当用户编辑并重新保存老 workflow 时，系统应引导其补齐缺失的 model，或自动写入默认 model

### 2. 对现有功能的影响边界

本需求只扩展 AI 配置维度，不改变原有 workflow 的核心执行机制，例如：

- phase 顺序
- checkpoint 审核
- reject target
- prompt / skill / artifact / worktree 等已有配置

## Acceptance Criteria

- 在编辑 workflow 的自动阶段时，用户可以选择 Claude Code SDK 或 Codex SDK。
- 在选定 SDK 后，用户可以继续为该阶段选择对应 model。
- 不同自动阶段可以保存不同的 SDK 和不同的 model。
- workflow 保存后，再次打开编辑器时，阶段的 SDK 和 model 能正确回显。
- 运行 workflow 时，阶段会按各自配置的 SDK 和 model 执行。
- 老 workflow 能被兼容加载，不会因为缺少 `model` 字段而直接不可用。

## Out Of Scope For Now

- 不在这次需求里设计完整的模型计费面板
- 不在这次需求里设计自动推荐最优 model 的策略引擎
- 不在这次需求里展开各 SDK 的底层调用改造细节
- 不在这次需求里支持两个以上的新 SDK
- 不在这次需求里设计按 token 成本实时估算的 UI

## Open Questions

- model 列表是固定内置，还是按 SDK 动态拉取？
- 当 SDK 切换后，旧 model 是自动替换成默认值，还是必须用户手动确认？
- 是否需要 workflow 级默认 SDK/model，用于新建 phase 时自动继承？
- 预览图、列表页、运行态详情里，是否都要展示 model 名称，还是只在编辑器里展示？
