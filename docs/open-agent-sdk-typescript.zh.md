# Open Agent SDK TypeScript 代码库说明

## 它是做什么的

`@codeany/open-agent-sdk` 是一个 TypeScript Agent SDK。它的核心目标是：在当前 Node.js 进程内运行完整的 agent loop，不依赖本地 CLI 子进程。

简单说，它把这些能力封装成一个可嵌入的 SDK：

- 调用 Anthropic Messages API 或 OpenAI Chat Completions 兼容 API。
- 让模型使用工具，比如读写文件、执行 Bash、搜索文件、访问网页、调用 MCP 工具等。
- 支持多轮会话、会话持久化、恢复和 fork。
- 支持自定义工具、MCP server、子 agent、skills、hooks、权限控制和自动上下文压缩。

典型用法是：

```ts
import { createAgent } from "@codeany/open-agent-sdk";

const agent = createAgent({ model: "gpt-4o" });
const result = await agent.prompt("What files are in this project?");

console.log(result.text);
```

也可以用流式接口：

```ts
import { query } from "@codeany/open-agent-sdk";

for await (const msg of query({
  prompt: "Read package.json and tell me the project name.",
  options: {
    allowedTools: ["Read", "Glob"],
    permissionMode: "bypassPermissions",
  },
})) {
  console.log(msg);
}
```

## 整体架构

主要入口在 `src/index.ts`。它导出了高层 API、工具系统、provider、MCP、skills、hooks、session 等模块。

核心模块关系如下：

```text
使用者代码
  |
  | createAgent() / query()
  v
Agent
  |
  | 创建 provider、组装工具、连接 MCP、恢复 session
  v
QueryEngine
  |
  | agent loop
  | 1. 构造 system prompt
  | 2. 调用 LLM provider
  | 3. 解析 tool_use
  | 4. 执行工具
  | 5. 把工具结果写回 messages
  | 6. 继续下一轮，直到模型不再调用工具
  v
Provider / Tools / MCP / Skills / Hooks / Session
```

## Agent 层

`src/agent.ts` 负责对外提供最常用的 API：

- `createAgent(options)`
- `agent.query(prompt)`
- `agent.prompt(text)`
- `query({ prompt, options })`

`Agent` 构造时主要做几件事：

1. 读取配置和环境变量，比如 `CODEANY_API_KEY`、`CODEANY_MODEL`、`CODEANY_BASE_URL`。
2. 根据 `apiType` 或模型名判断使用 Anthropic provider 还是 OpenAI-compatible provider。
3. 初始化内置 skills。
4. 根据 `tools`、`allowedTools`、`disallowedTools` 组装工具池。
5. 连接 MCP server，把 MCP tools 合并到工具池。
6. 如果设置了 `resume`，从磁盘加载历史 session。

`agent.prompt()` 是阻塞式封装，会内部消费 `agent.query()` 的流式事件，最后返回一个聚合结果。`agent.query()` 则直接返回 `AsyncGenerator<SDKMessage>`，适合做 CLI、Web UI 或实时日志。

## QueryEngine：核心工作循环

真正的 agent loop 在 `src/engine.ts` 的 `QueryEngine` 里。

它的执行流程是：

1. 触发 `SessionStart`、`UserPromptSubmit` 等 hooks。
2. 把用户 prompt 加入 `messages`。
3. 构造 system prompt。
4. 把工具定义转换成 provider 可理解的 schema。
5. 调用 LLM API。
6. 把 assistant 响应加入历史，并向外 yield `assistant` 事件。
7. 如果响应里有 `tool_use`，执行对应工具。
8. 把工具结果作为 `tool_result` 写回 `messages`。
9. 继续下一轮 LLM 调用。
10. 如果没有工具调用、达到最大轮数、预算耗尽或被中断，就结束并 yield `result`。

这就是它的核心机制：模型不是直接操作文件或系统，而是先输出结构化的 tool call，SDK 在本地执行工具，再把结果反馈给模型。

## Provider 层

Provider 抽象定义在 `src/providers/types.ts`。SDK 内部使用一种接近 Anthropic 的统一消息格式：

```ts
interface LLMProvider {
  readonly apiType: "anthropic-messages" | "openai-completions";
  createMessage(params: CreateMessageParams): Promise<CreateMessageResponse>;
}
```

目前有两个实现：

- `src/providers/anthropic.ts`
  - 使用 `@anthropic-ai/sdk`。
  - 因为内部格式本来就接近 Anthropic，所以转换很薄。
- `src/providers/openai.ts`
  - 使用原生 `fetch` 调用 `/chat/completions`。
  - 把内部的 `tool_use` 转成 OpenAI `tool_calls`。
  - 把 OpenAI 的 `tool_calls` 再转回 SDK 内部的 `tool_use`。

这层的意义是把不同模型 API 的差异隔离掉，让 `QueryEngine` 只处理统一格式。

## 工具系统

工具定义类型在 `src/types.ts`：

```ts
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  call: (input: any, context: ToolContext) => Promise<ToolResult>;
  isReadOnly?: () => boolean;
  isConcurrencySafe?: () => boolean;
  isEnabled?: () => boolean;
}
```

内置工具在 `src/tools/index.ts` 统一注册，包括：

- 文件和命令：`Read`、`Write`、`Edit`、`Bash`、`Glob`、`Grep`
- Web：`WebFetch`、`WebSearch`
- 多 agent：`Agent`、`SendMessage`、`TeamCreate`、`TeamDelete`
- 任务系统：`TaskCreate`、`TaskList`、`TaskUpdate` 等
- MCP resource：`ListMcpResources`、`ReadMcpResource`
- planning、cron、LSP、config、todo、skill 等

执行工具时，`QueryEngine` 会把工具调用分成两类：

- 只读工具：并发执行，默认最大并发数是 10。
- 会修改状态的工具：串行执行，避免并发写入造成冲突。

权限控制通过 `canUseTool` 完成。如果返回 `deny`，工具不会执行，模型会收到权限拒绝结果。

## MCP 集成

MCP client 在 `src/mcp/client.ts`。

它支持三类外部 MCP transport：

- `stdio`
- `sse`
- `http`

连接 MCP server 后，SDK 会调用 `listTools()` 获取工具列表，并把每个 MCP tool 包装成 SDK 内部的 `ToolDefinition`。工具名会加命名空间：

```text
mcp__{serverName}__{toolName}
```

另外，`src/sdk-mcp-server.ts` 支持 in-process MCP server。也就是用 `tool()` 定义工具，然后通过 `createSdkMcpServer()` 直接挂到 agent，不需要启动额外进程。

## Skills 系统

Skills 是可复用的 prompt 模板，代码在 `src/skills`。

注册中心在 `src/skills/registry.ts`，支持：

- `registerSkill`
- `getSkill`
- `getAllSkills`
- `getUserInvocableSkills`
- `unregisterSkill`

模型通过内置的 `Skill` 工具调用 skill。`src/tools/skill-tool.ts` 会找到对应 skill，执行 `getPrompt()`，然后把生成的 prompt 返回给模型。

内置 bundled skills 包括：

- `simplify`
- `commit`
- `review`
- `debug`
- `test`

它们本质上不是独立模型能力，而是把特定工作流整理成 prompt，让主 agent 按模板继续执行。

## Hooks 系统

Hooks 在 `src/hooks.ts`。它允许使用者在 agent 生命周期里插入逻辑，例如：

- `SessionStart`
- `SessionEnd`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `PostToolUseFailure`
- `PreCompact`
- `PostCompact`

`PreToolUse` 和 `UserPromptSubmit` 这类 hook 可以返回 `block: true`，用来阻止 prompt 或工具执行。

## Session 持久化

Session 逻辑在 `src/session.ts`。

会话默认保存到：

```text
~/.open-agent-sdk/sessions/{sessionId}/transcript.json
```

每个 session 保存：

- metadata：session id、cwd、model、创建时间、更新时间、消息数量等
- messages：统一格式的对话历史

SDK 支持：

- 保存 session
- 加载 session
- 列出 sessions
- fork session
- 重命名和打 tag
- 删除 session

`Agent.close()` 时，如果 `persistSession` 没有显式关闭，会尝试保存当前会话。

## 上下文注入和压缩

`src/utils/context.ts` 会把一些项目上下文注入 system prompt：

- 当前日期
- git branch
- main branch
- git user
- `git status --short`
- 最近 5 条 commit
- `AGENT.md`、`CLAUDE.md`、`.claude/CLAUDE.md` 等项目说明文件
- 当前工作目录

`src/utils/compact.ts` 和 `src/utils/tokens.ts` 负责上下文管理：

- 估算 token 数量和成本。
- 当上下文接近模型窗口上限时，触发 auto-compact。
- 对超大的工具结果做 micro-compact，避免一次工具输出撑爆上下文。

## 自定义工具

SDK 提供两套工具定义方式。

低层方式是 `defineTool()`：

```ts
const calculator = defineTool({
  name: "Calculator",
  description: "Evaluate a math expression",
  inputSchema: {
    type: "object",
    properties: {
      expression: { type: "string" },
    },
    required: ["expression"],
  },
  async call(input) {
    return String(eval(input.expression));
  },
});
```

高层方式是 `tool()`，使用 Zod schema，代码在 `src/tool-helper.ts`：

```ts
const getWeather = tool(
  "get_weather",
  "Get weather for a city",
  { city: z.string() },
  async ({ city }) => ({
    content: [{ type: "text", text: `${city}: sunny` }],
  }),
);
```

`tool()` 定义的工具可以通过 `createSdkMcpServer()` 变成 in-process MCP server。

## 一次请求的完整链路

以 `agent.prompt("Read package.json")` 为例：

1. 使用者调用 `createAgent()` 创建 agent。
2. Agent 读取配置，创建 provider，准备工具池。
3. `prompt()` 调用内部的 `query()`。
4. `query()` 创建 `QueryEngine`。
5. `QueryEngine` 构造 system prompt，包括工具列表、git 状态、项目说明文件等。
6. `QueryEngine` 调用 provider。
7. 模型返回 `tool_use: Read`。
8. `QueryEngine` 找到 `Read` 工具并执行本地文件读取。
9. 工具结果作为 `tool_result` 放回对话历史。
10. `QueryEngine` 再次调用模型。
11. 模型根据文件内容生成最终回答。
12. SDK 返回 `QueryResult`，包含文本、token usage、turn 数、消息历史等。

## 代码库定位

这个项目可以理解为“可嵌入应用里的 coding-agent/runtime SDK”。

它不是一个纯 API client，也不是简单聊天 SDK。它包含完整的 agent runtime：

- 模型调用
- tool calling
- 工具执行
- 会话状态
- 权限控制
- MCP 扩展
- skills 工作流
- hooks 生命周期
- 上下文注入和压缩

也正因为它把 agent loop 放在 SDK 内部运行，所以适合嵌入到 Web 服务、CI/CD、Docker、serverless 或自定义开发者工具中。
