# TODO: 任务内 Git 文件变更、历史记录与 Diff 查看

## Background

当前任务详情页已经能展示 workflow 阶段、AI 对话、输出文档和关联的 Git worktree。

但用户在一个任务里还不能直接看到这次任务到底改了哪些文件，也不能像 VS Code Source Control 或 GitHub Pull Request 那样，在 APP 内查看文件列表、提交历史和逐文件 diff。

这会导致用户必须跳到 VS Code 或命令行里确认改动，任务视图本身不能完整回答：

- 这个任务改了哪些文件
- 每个文件具体改了什么
- 当前 worktree 有哪些未提交改动
- 这个任务分支上有哪些提交记录

## Goal

在任务详情页增加一个 Git 变更查看能力，让用户在单个任务中就能看到关联仓库的文件变更、提交历史和 GitHub 风格 diff。

目标体验接近：

- VS Code Source Control 的 Changed Files 列表
- GitHub Pull Request 的 Files changed 页面
- 简化版 Git history / commit list

## Assumptions

- 这个功能优先服务 desktop 端任务详情页。
- 任务如果启用了 worktree，默认查看任务自己的 worktree。
- 任务如果没有启用 worktree，则查看任务的 `workFolder`。
- 第一阶段只做只读查看，不在 diff UI 里编辑文件。
- 第一阶段只展示本地 Git 状态和本地提交历史，不直接依赖 GitHub API。

## Current State

当前相关链路大致是：

- `apps/desktop/renderer/src/pages/TicketPage.jsx`
  - 任务详情页入口
  - 已经展示 task id、phase、worktree badge、调试面板
  - worktree badge 可以打开关联目录

- `apps/desktop/renderer/src/stores/workflowStore.js`
  - 负责加载任务状态
  - `loadTicket()` 会读取 `state`、messages、artifacts、interactions

- `apps/desktop/electron/api.mjs`
  - `getTaskState()` 读取任务状态
  - 已经有 Electron IPC API 可以打开任务输出或 worktree

- `apps/desktop/local-server-controllers/workfoldersController.mjs`
  - Web/local server 路径也能读取任务状态

- `packages/core-models/state.mjs`
  - `workflow-state.json` 里保存 `workFolder`、`originalWorkFolder`、`worktree`
  - 如果启用了 worktree，状态里已经有 `worktree.rootPath`、`branchName`、`sourceRoot`

- `packages/core-lib/worktree.mjs`
  - 负责创建和删除 Git worktree
  - 目前不负责读取 diff 或提交历史

## Requirement

### 1. 任务详情页增加 Git 视图入口

在任务详情页增加一个清晰入口，例如顶部按钮或详情区 tab：

- Conversation / Document
- Files changed
- History

第一阶段建议放在 `TicketPage.jsx` / `StepDetail.jsx` 附近，不要先引入复杂路由。

如果当前任务没有可用 Git 仓库，需要展示空状态：

- 不是 Git 仓库
- 任务没有关联 worktree
- 无法读取 Git 状态

### 2. 文件变更列表

需要展示当前任务关联目录里的 Git 文件状态。

至少包含：

- modified
- added
- deleted
- renamed
- untracked

每个文件项需要展示：

- 文件路径
- 状态标识
- 增加行数 / 删除行数，如果能稳定获取

点击文件后，在右侧或主区域打开该文件的 diff。

### 3. GitHub 风格 Diff UI

Diff UI 需要接近 GitHub 的 Files changed 体验。

至少支持：

- 按文件分组
- 展示文件头
- 展示 hunks
- 增加行绿色背景
- 删除行红色背景
- context 行正常背景
- 行号展示 old line / new line
- 空文件、二进制文件、超大文件有明确提示

第一阶段可以先做 unified diff 展示，不要求 side-by-side。

### 4. 提交历史记录

在任务中可以查看当前任务分支的提交历史。

至少展示：

- commit hash 短码
- commit message
- author
- commit time

点击某个 commit 后，可以查看该 commit 的 diff。

第一阶段可以只展示最近 50 条提交。

### 5. Diff 范围

需要明确不同视图的 diff 范围。

建议第一阶段支持两类：

- Working tree diff：当前未提交改动，等价于 `git diff` + untracked 文件摘要
- Commit diff：某个 commit 的改动，等价于 `git show --stat --patch <sha>`

后续可以扩展：

- branch against base，例如 `main...currentBranch`
- staged diff
- phase-level diff

### 6. 与 Worktree 的关系

任务启用 worktree 时，所有 Git 读取应优先使用：

```text
workflowState.worktree.rootPath
```

如果没有 worktree，再 fallback 到：

```text
workflowState.workFolder
```

这样用户看到的是任务实际修改目录，而不是原始仓库目录。

### 7. 后端 / Electron API

需要新增只读 Git API，而不是让 renderer 直接执行 Git。

建议最小 API：

- `getTaskGitSummary(taskId, runId)`
  - 返回仓库信息、当前 branch、changed files、最近 commits

- `getTaskGitFileDiff(taskId, runId, filePath)`
  - 返回单个文件的 working tree diff

- `getTaskGitCommitDiff(taskId, runId, commitSha)`
  - 返回某个 commit 的 diff

Electron 桌面端走 IPC：

- `apps/desktop/electron/preload.cjs`
- `apps/desktop/electron/main.mjs`
- `apps/desktop/electron/api.mjs`

Web/local server 端走 HTTP：

- `apps/desktop/local-server-controllers/workfoldersController.mjs` 或新的 task git controller
- `apps/desktop/renderer/src/lib/api-client.js`

## UX Requirement

### 1. 布局

任务详情页建议采用 tab 或 segmented control：

- Output
- Conversation
- Files
- History

考虑当前页面已经是左侧 phase list + 右侧详情区，第一阶段可以把 Git 视图放在右侧详情区，不改变左侧 phase list。

### 2. 文件列表体验

文件列表需要适合扫描：

- 左侧文件路径
- 右侧状态 badge
- 可选显示 `+12 -3`
- 当前选中文件有高亮状态

文件很多时需要支持滚动，不要撑破任务页布局。

### 3. Diff 可读性

Diff 区域需要使用等宽字体，但整体仍然保持桌面工具风格。

需要避免：

- 大块 diff 让页面横向溢出
- 长文件路径压坏标题栏
- 超大 diff 造成 UI 卡顿

### 4. 空状态

需要覆盖这些状态：

- 没有改动
- 当前目录不是 Git 仓库
- Git 命令不可用
- 文件是二进制文件
- diff 太大，提示去 VS Code 查看

## Implementation Notes

### Git 命令建议

第一阶段可以用 Git CLI 读取数据，保持实现简单。

可用命令：

```text
git rev-parse --show-toplevel
git branch --show-current
git status --porcelain=v1
git diff --numstat
git diff -- <file>
git log --pretty=format:%h%x09%H%x09%an%x09%ai%x09%s -n 50
git show --stat --patch --format=fuller <sha>
```

不要用 shell 拼接用户输入；应使用 `execFile("git", args, { cwd })`。

### Diff 解析建议

第一阶段可以先在前端展示 unified diff 文本，并做简单行级样式：

- `+` 开头为新增
- `-` 开头为删除
- `@@` 开头为 hunk header
- 其他为 context

如果后面要做更接近 GitHub 的行号和折叠体验，再引入更完整的 diff parser。

## Security / Safety

- 只能读取当前任务关联的 repo/worktree。
- API 入参里的 `filePath` 必须是相对路径，不能允许绝对路径。
- 需要防止 `../` 跳出仓库。
- Git 命令必须使用参数数组，不要拼接 shell 字符串。
- diff 输出需要限制大小，避免一次返回超大文本拖垮 renderer。

## MVP

第一阶段建议只做：

- 任务详情页增加 `Files` tab
- 展示 changed files 列表
- 点击文件查看 working tree unified diff
- 没有 worktree 时 fallback 到 `workFolder`
- 没有 Git 仓库时展示空状态

暂时不做：

- staged / unstaged 分组
- side-by-side diff
- inline comments
- GitHub remote PR 集成
- phase-level diff

## Acceptance Criteria

- 打开一个任务后，可以在任务详情中进入 Git 文件变更视图。
- 如果任务启用了 worktree，Git 视图读取的是该任务 worktree。
- 可以看到当前任务目录下的 changed files。
- 点击某个文件后，可以看到该文件的 unified diff。
- Diff UI 能区分新增、删除和 context 行。
- 可以查看最近提交历史。
- 点击 commit 可以查看该 commit 的 diff。
- 非 Git 目录、无改动、二进制文件、超大 diff 都有明确提示。
- renderer 不直接执行 Git 命令，Git 读取通过 Electron/API 层完成。

## Out Of Scope For Now

- 不在本期实现代码编辑
- 不在本期实现 commit / stage / discard 操作
- 不在本期实现 PR 创建或 GitHub API 集成
- 不在本期实现代码 review comment
- 不在本期实现跨任务全局 Git 历史搜索
- 不在本期实现 phase-level 精确 diff 归因

## Open Questions

- 文件变更视图是 task-level tab，还是每个 phase 内都显示？
- History 默认展示当前分支所有提交，还是只展示任务开始之后的提交？
- 是否需要记录任务启动时的 base commit，用于生成更准确的任务级 diff？
- 对 untracked 文件是否展示完整内容 diff，还是只展示文件已新增？
- 后续是否需要支持 side-by-side diff？
