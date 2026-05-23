# HIVE 终端 UI 与 PTY 方案分析

## 结论

HIVE 不是 Next.js 方案，而是一个基于 `React + Vite + TypeScript` 的浏览器端工作台。它的终端体验核心是 `xterm.js + node-pty + WebSocket`，前端只负责渲染，真正执行命令的是后端拉起的真实 PTY 进程。

对我们当前的 task 页面来说，这套思路可以直接借用。更准确地说，最值得借的是“终端式工作台 + 长期 PTY 会话 + 输出镜像 + 输入回传”这一层，不是它的整页布局。

## HIVE 用了什么技术

- 前端框架：React
- 构建工具：Vite
- UI 组件：Tailwind CSS、Radix UI、lucide-react
- 终端渲染：`xterm.js`
- 终端进程：`node-pty`
- 通信层：WebSocket
- 后端运行时：Node.js
- 元数据存储：SQLite

`references/hive/package.json` 里可以直接看到这些依赖。

## 它的终端 UI 是怎么做的

HIVE 的前端终端不是普通输入框，而是一个真正的 terminal view。

关键文件大概是这些：

- `references/hive/web/src/terminal/TerminalView.tsx`
- `references/hive/web/src/terminal/TerminalBottomPanel.tsx`
- `references/hive/web/src/WorkspaceTerminalPanels.tsx`
- `references/hive/src/server/terminal-ws-server.ts`
- `references/hive/src/server/terminal-stream-hub.ts`

它的做法可以概括成四层：

1. 后端启动真实 PTY 进程。
2. PTY 输出通过 WebSocket 发给前端。
3. 前端用 `xterm.js` 渲染这些字节流。
4. 输入、Ctrl+C、resize 之类的控制信号再回传给后端。

它还有一个很关键的点：`TerminalView` 会把同一个 xterm 实例重新挂到不同的 DOM slot 上，这样切换视图时不会重建 terminal。

## HIVE 的 UI 框架特点

HIVE 的 UI 更像一个“终端控制台”而不是聊天面板。

- 有终端 tab
- 有底部面板
- 有 resize handle
- 有状态镜像和恢复
- 有控制通道和 IO 通道分离

这套 UI 逻辑非常适合“程序员工作台”的语境。

## 能不能借到我们当前项目里

可以。

而且最合适的改法就是：

- 左侧保留原来的 task / workflow 结构
- 右侧彻底换成 terminal 式工作台
- 终端底层用 PTY
- 前端用 `xterm.js`
- 通信用 WebSocket
- 用户输入直接进 PTY stdin
- `Ctrl+C` 直接中断当前进程

这样右侧就不再是聊天气泡，而是更接近真实 Codex / Claude CLI 的使用方式。

## 需要注意的点

如果我们要走这条路，`xterm.js` 只负责显示，不负责 workflow 语义。也就是说：

- 终端输出结束，不等于整个 workflow 结束
- workflow 继续下一步，需要后端明确知道当前 step 已完成
- 终端会话和 workflow state 要分开保存

这点很重要，不然右侧看起来像终端，实际流程还是会卡在“UI 结束了，但调度没结束”。

## 参考源码

- `references/hive/package.json`
- `references/hive/web/src/terminal/TerminalView.tsx`
- `references/hive/web/src/terminal/TerminalBottomPanel.tsx`
- `references/hive/web/src/WorkspaceTerminalPanels.tsx`
- `references/hive/src/server/terminal-ws-server.ts`
- `references/hive/src/server/terminal-stream-hub.ts`
- `references/hive/README.en.md`

