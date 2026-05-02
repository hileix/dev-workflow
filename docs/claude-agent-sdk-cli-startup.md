# Claude Agent SDK 如何启动 Claude Code CLI

本文基于 `@anthropic-ai/claude-agent-sdk@0.2.123` 的 npm 包内容分析。这个包对应的 `claudeCodeVersion` 是 `2.1.123`。

## 结论

`@anthropic-ai/claude-agent-sdk` 本质上不是直接在 TypeScript SDK 内调用 Claude Messages API 完成 agent 循环，而是把 Claude Code 作为一个子进程启动起来，然后通过 stdin/stdout 的 `stream-json` 协议和这个子进程通信。

也就是说，SDK 的主要职责是：

- 找到当前平台对应的 Claude Code 可执行文件。
- 把 `query()` 的 options 转换成 Claude Code CLI 参数。
- 用 `child_process.spawn()` 启动 Claude Code。
- 往子进程 stdin 写入用户消息 JSONL。
- 从子进程 stdout 读取 Claude Code 返回的流式 JSONL。
- 处理权限回调、hooks、MCP、session store mirror、resume 等 SDK 层能力。

真正执行 agent loop、调用模型、调工具、读写文件、跑 Bash 的核心逻辑在 Claude Code CLI 里。

## 包结构

安装 `@anthropic-ai/claude-agent-sdk` 后，主包里有：

```text
@anthropic-ai/claude-agent-sdk/
  sdk.mjs
  sdk.d.ts
  bridge.mjs
  assistant.mjs
  browser-sdk.js
  package.json
```

主包还声明了一组平台相关的 optional dependencies，例如：

```text
@anthropic-ai/claude-agent-sdk-darwin-arm64
@anthropic-ai/claude-agent-sdk-darwin-x64
@anthropic-ai/claude-agent-sdk-linux-x64
@anthropic-ai/claude-agent-sdk-win32-x64
```

在 macOS arm64 上实际安装的是：

```text
@anthropic-ai/claude-agent-sdk-darwin-arm64/
  claude
  package.json
```

其中 `claude` 是一个原生 Mach-O arm64 可执行文件，大约 206 MB。SDK 默认会启动这个文件。

## query() 的启动链路

用户代码通常这样调用：

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const message of query({
  prompt: 'Hello',
  options: {
    cwd: process.cwd(),
    model: 'claude-sonnet-4-6',
    maxTurns: 1,
  },
})) {
  console.log(message)
}
```

内部链路可以简化为：

```text
query()
  -> 组装 Query 实例
  -> 创建 ProcessTransport
  -> 找到 Claude Code 可执行文件
  -> 组装 CLI args 和 env
  -> spawn Claude Code 子进程
  -> stdin 写入用户消息
  -> stdout 读取 SDKMessage
```

## 如何找到 Claude Code 可执行文件

SDK 会先看用户是否传了：

```ts
options.pathToClaudeCodeExecutable
```

如果没有传，它会根据 `process.platform` 和 `process.arch` 去解析 optional dependency 里的可执行文件：

```text
@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude
```

例如当前机器是 macOS arm64，所以会解析：

```text
@anthropic-ai/claude-agent-sdk-darwin-arm64/claude
```

如果找不到 native binary，SDK 会报错，提示重新安装并保留 optional dependencies，或者显式传入 `pathToClaudeCodeExecutable`。

## 启动时传给 CLI 的参数

SDK 会把 `query()` 的 options 映射成 CLI 参数。一个最小示例大概会启动：

```bash
claude \
  --output-format stream-json \
  --verbose \
  --input-format stream-json \
  --max-turns 1 \
  --model claude-sonnet-4-6 \
  --permission-mode plan
```

其中几个关键参数是固定的：

- `--output-format stream-json`：要求 CLI 用流式 JSON 输出。
- `--input-format stream-json`：要求 CLI 从 stdin 读取流式 JSON 输入。
- `--verbose`：让 CLI 输出更完整的 SDK message 流。

其他 options 会继续映射成对应 CLI 参数：

```text
model -> --model
maxTurns -> --max-turns
maxBudgetUsd -> --max-budget-usd
permissionMode -> --permission-mode
allowedTools -> --allowedTools
disallowedTools -> --disallowedTools
tools -> --tools
mcpServers -> --mcp-config
resume -> --resume
continue -> --continue
sessionId -> --session-id
systemPrompt/settings/sandbox 等 -> 对应设置或额外参数
```

SDK 支持 `spawnClaudeCodeProcess`，如果传了这个 callback，就不会走默认本地 `spawn()`，而是把下面这些信息交给调用方自己启动：

```ts
{
  command,
  args,
  cwd,
  env,
  signal,
}
```

这通常用于把 Claude Code 放进 VM、容器或远程环境里执行。

## 环境变量

SDK 启动子进程前会复制 `options.env` 或 `process.env`，然后注入一些 SDK 相关变量。

常见的有：

```text
CLAUDE_CODE_ENTRYPOINT=sdk-ts
CLAUDE_AGENT_SDK_VERSION=0.2.123
```

如果启用了某些功能，还会加入额外变量，例如：

```text
CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=true
CLAUDE_CODE_SDK_HAS_OAUTH_REFRESH=1
CLAUDE_CODE_QUESTION_PREVIEW_FORMAT=...
```

认证信息一般通过环境变量或本机 Claude Code 登录状态传给 CLI，例如：

```text
ANTHROPIC_API_KEY
CLAUDE_CODE_OAUTH_TOKEN
CLAUDE_CONFIG_DIR
```

SDK 本身没有在主流程里直接手写 Messages API 请求。它把认证环境传给 Claude Code CLI，由 CLI 去完成实际的模型调用。

## stdin/stdout 通信协议

SDK 会向 Claude Code 子进程的 stdin 写 JSONL。普通字符串 prompt 会被包装成类似这样的用户消息：

```json
{"type":"user","session_id":"","message":{"role":"user","content":[{"type":"text","text":"Hello"}]},"parent_tool_use_id":null}
```

每条消息后面加换行。

Claude Code CLI 的 stdout 也会按行输出 JSON。SDK 逐行读取、`JSON.parse()`，然后 yield 给用户：

```ts
for await (const message of query(...)) {
  // message 来自 CLI stdout 的 stream-json
}
```

所以 `query()` 返回的是一个 `AsyncGenerator<SDKMessage>`。常见 message 类型包括：

- `system`：初始化、状态变化等。
- `assistant`：Claude 的 assistant message。
- `user`：工具结果等用户侧消息。
- `result`：本轮结束结果。

## ProcessTransport 做了什么

SDK 内部的 ProcessTransport 负责管理子进程生命周期：

- 启动 Claude Code 子进程。
- 保存 stdin/stdout 引用。
- abort 时发送 `SIGTERM`。
- close 时先结束 stdin，必要时再终止进程。
- 监听 `error` 和 `exit`。
- 把 stdout 的每一行 JSON 解析成 SDK message。
- 如果进程非 0 退出，转换成 SDK 错误。

默认本地启动时使用 Node 的：

```ts
child_process.spawn(command, args, {
  cwd,
  stdio: ['pipe', 'pipe', stderrMode],
  signal,
  env,
  windowsHide: true,
})
```

## 权限、hooks、MCP 怎么回传

虽然主消息流是 stdout，但 SDK 还会处理一些特殊控制消息：

- `control_request`
- `control_response`
- `control_cancel_request`
- `transcript_mirror`
- `keep_alive`

例如设置了 `canUseTool` 时，SDK 会把 CLI 参数设为：

```text
--permission-prompt-tool stdio
```

这表示 Claude Code CLI 遇到工具权限请求时，会通过 stdio 给 SDK 发控制请求。SDK 调用用户传入的 `canUseTool` callback 后，再把 decision 写回 CLI。

hooks、SDK MCP server、elicitation 等能力也是类似思路：Claude Code CLI 发控制事件，SDK 在 TypeScript 侧执行 callback，再通过 stdin 回传结果。

## SessionStore 的工作方式

这个仓库里的 S3、Redis、Postgres 代码都是 `SessionStore` 示例 adapter。它们不是 SDK 启动 Claude 的核心，而是给 SDK 的 session mirror/resume 功能用的。

可以把 `SessionStore` 理解成 Claude Code 本地 session 存储之外的“外部 transcript 镜像层”。它最直接的用途确实是 resume，但不只用于 resume。

当传入：

```ts
options: { sessionStore }
```

SDK 仍然会让 Claude Code CLI 写本地 transcript，然后开启：

```text
--session-mirror
```

CLI 会发出 `transcript_mirror` frame，SDK 收到后调用：

```ts
sessionStore.append(key, entries)
```

resume 时，如果使用外部 `sessionStore`，SDK 会先把外部存储里的 transcript materialize 成一个临时 `CLAUDE_CONFIG_DIR`，再用 `--resume` 启动 Claude Code CLI。

所以外部 store 的作用是“镜像和恢复会话”，不是替代 Claude Code CLI，也不是让 SDK 绕过 Claude Code 自己的本地 session 机制。

### Store 除了 resume 还有什么作用

`SessionStore` 的核心接口包括：

```ts
append(key, entries)
load(key)
listSessions?(projectKey)
delete?(key)
listSubkeys?(key)
```

这些能力对应几类用途：

- `append()`：把 Claude Code 本地写入成功后的 transcript 追加镜像到外部系统。
- `load()`：resume 时从外部系统读回 transcript。
- `listSessions()`：支持 `continue`，也支持在外部系统里列出某个项目下有哪些 session。
- `delete()`：让 SDK 的 `deleteSession()` 能删除外部存储里的 session。
- `listSubkeys()`：恢复或读取 subagent transcript，因为 subagent 会话存储在主 session 下面的 subpath 里。

因此，resume 是最主要的消费场景，但 store 也提供了跨机器 session 列表、删除、读取历史消息、读取 subagent 消息、导入本地 session 到外部存储等管理能力。

### 为什么 Claude Code 已经存 session，还需要 Store

Claude Code CLI 本身会把 session 写到本机 `CLAUDE_CONFIG_DIR` 下，默认通常是用户目录里的 `.claude/projects/...`。这对单机 CLI 使用足够，但对 SDK 嵌入场景有几个限制：

- 本地磁盘只在当前机器可见。服务端多实例、容器、CI、serverless、桌面应用多设备同步时，下一次请求可能不在同一台机器上。
- 本地 session 生命周期跟机器或容器绑定。容器销毁后，本地 transcript 也可能丢失。
- 产品侧通常需要统一管理 session，例如按用户、租户、项目做持久化、审计、检索、备份、清理和合规保留。
- SDK host 可能想让 `CLAUDE_CONFIG_DIR` 指向临时目录，避免长期在运行环境本地落盘，但仍然需要把 session 保存到自己的系统里。
- Claude Code 的本地 session 格式是 CLI 的运行时存储；外部 store 则是 SDK 暴露出来的可控持久化边界，方便接入 Redis、S3、Postgres 等基础设施。

所以这里是双写模型：

```text
Claude Code CLI
  -> 先写本地 transcript
  -> 通过 transcript_mirror 通知 SDK
  -> SDK 调用 SessionStore.append() 写外部存储
```

resume 时则反过来：

```text
SessionStore.load()
  -> SDK 生成临时 CLAUDE_CONFIG_DIR/projects/.../*.jsonl
  -> spawn claude --resume <sessionId>
  -> Claude Code CLI 仍然按自己的本地 session 机制恢复
```

这个设计的重点是：不改 Claude Code CLI 的核心 session 读取逻辑，而是在 SDK 层提供一个外部持久化和跨环境恢复的桥。

### Store 不是强一致主存储

文档里也强调，`append()` 失败会被记录并作为 stream error 暴露，但不会阻塞当前对话。也就是说外部 store 更像 mirror，而不是 Claude Code 执行路径上的强依赖数据库。

这有一个重要含义：对话能继续运行，不会因为 Redis/S3/Postgres 短暂失败就直接中断；但如果 mirror 失败，后续从外部 store resume 时可能缺少部分 transcript。因此生产环境需要监控 mirror error，并根据业务要求做重试、告警或补偿。

## Direct Connect 是另一条路径

SDK 里还有 `DirectConnectTransport`，它不是启动本地 CLI，而是连接远程 Claude Code server：

- 先 `POST /sessions` 创建 session。
- 再通过 WebSocket 连接服务端返回的 `ws_url`。
- 后续消息通过 WebSocket JSONL 传输。

但普通 `query()` 默认走的是本地 Claude Code 子进程。

## 总结

`@anthropic-ai/claude-agent-sdk` 的启动模型可以概括成：

```text
TypeScript SDK
  -> resolve platform native claude binary
  -> spawn claude --input-format stream-json --output-format stream-json ...
  -> write user/control JSONL to stdin
  -> read assistant/system/result JSONL from stdout
  -> expose AsyncGenerator API to caller
```

因此，它更像是 Claude Code CLI 的程序化 wrapper 和 transport 层。真正的 agent 能力、模型调用、工具执行、权限策略和 transcript 写入，主要发生在 Claude Code CLI 子进程内部。
