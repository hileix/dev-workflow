# Codex SDK 如何调用 Codex CLI

结论：这个仓库里的 SDK 本质上都是通过本机 Codex 可执行文件来驱动 Codex，但调用方式不同。

- TypeScript SDK：直接包装 `codex exec --experimental-json`。
- Python SDK：启动 `codex app-server --listen stdio://`，再通过 JSON-RPC v2 调用 app-server。

## TypeScript SDK

入口在 `sdk/typescript/src/codex.ts`。

使用者创建：

```ts
const codex = new Codex();
const thread = codex.startThread();
const result = await thread.run("...");
```

内部流程是：

1. `Codex` 构造 `CodexExec`。
2. `CodexExec` 找到本机平台对应的 Codex binary。
3. `Thread.run()` 调用 `runStreamedInternal()`。
4. `runStreamedInternal()` 调用 `CodexExec.run()`。
5. `CodexExec.run()` 使用 `child_process.spawn()` 启动：

```bash
codex exec --experimental-json ...
```

prompt 不是作为命令行参数传入，而是写入子进程 stdin：

```ts
child.stdin.write(args.input);
child.stdin.end();
```

Codex CLI 的 stdout 是 JSONL。SDK 用 `readline` 一行一行读取 stdout，然后把每一行 `JSON.parse()` 成事件：

```ts
for await (const line of stdout) {
  yield JSON.parse(line);
}
```

`Thread.run()` 是对流式事件的再包装：它收集 `item.completed`、`turn.completed` 等事件，最后返回：

- `items`
- `finalResponse`
- `usage`

如果要继续同一个对话，SDK 会保存 `thread.started` 事件里的 `thread_id`。下一次 run 时，如果已有 thread id，就会追加：

```bash
codex exec --experimental-json resume <thread_id>
```

所以 TypeScript SDK 可以理解为 Codex CLI 的轻量包装层：它负责参数转换、启动 CLI、写 stdin、读 JSONL stdout、整理事件。

## TypeScript SDK 如何找到 Codex binary

文件：`sdk/typescript/src/exec.ts`

默认情况下，SDK 不直接调用 PATH 里的 `codex`，而是解析 npm 包里的平台 binary。

它先根据当前平台生成 target triple，例如：

- macOS arm64：`aarch64-apple-darwin`
- macOS x64：`x86_64-apple-darwin`
- Linux x64：`x86_64-unknown-linux-musl`
- Windows x64：`x86_64-pc-windows-msvc`

然后定位：

```text
@openai/codex
└── optional platform package
    └── vendor/<target-triple>/codex/codex
```

如果找不到，会报错提示安装 `@openai/codex` 及其 optional dependencies。

也可以通过 `codexPathOverride` 指定自己的 binary 路径。

## TypeScript SDK 参数如何映射到 CLI

`CodexExec.run()` 会把 SDK options 转成 CLI 参数：

| SDK 选项 | CLI 参数 |
|---|---|
| `model` | `--model` |
| `sandboxMode` | `--sandbox` |
| `workingDirectory` | `--cd` |
| `additionalDirectories` | `--add-dir` |
| `skipGitRepoCheck` | `--skip-git-repo-check` |
| `outputSchemaFile` | `--output-schema` |
| `threadId` | `resume <threadId>` |
| `images` | `--image <path>` |
| `baseUrl` | `--config openai_base_url=...` |
| `approvalPolicy` | `--config approval_policy=...` |
| `webSearchMode` | `--config web_search=...` |

SDK 里的 `config` 对象会被展开成 dotted TOML overrides，例如：

```ts
{
  sandbox_workspace_write: {
    network_access: true,
  },
}
```

会变成：

```bash
--config sandbox_workspace_write.network_access=true
```

如果传了 `apiKey`，SDK 会注入环境变量：

```text
CODEX_API_KEY=<api key>
```

同时还会设置：

```text
CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_sdk_ts
```

## Python SDK

入口在 `sdk/python/src/codex_app_server/api.py` 和 `sdk/python/src/codex_app_server/client.py`。

Python SDK 不是直接调用 `codex exec`。它启动的是：

```bash
codex app-server --listen stdio://
```

然后通过 stdin/stdout 发送 JSON-RPC v2 消息。

典型使用方式：

```py
from codex_app_server import Codex

with Codex() as codex:
    thread = codex.thread_start(model="gpt-5")
    result = thread.run("Say hello.")
```

内部流程是：

1. `Codex()` 创建 `AppServerClient`。
2. `AppServerClient.start()` 用 `subprocess.Popen()` 启动 Codex binary。
3. 默认启动参数是：

```bash
codex app-server --listen stdio://
```

4. `Codex()` 立即发送 `initialize` JSON-RPC 请求。
5. `thread_start()` 发送 `thread/start`。
6. `thread.run()` 发送 `turn/start`。
7. SDK 持续读取 server notification，直到收到 `turn/completed`。

Python SDK 每条消息都是一行 JSON。写请求时：

```py
stdin.write(json.dumps(payload) + "\n")
```

读响应和通知时：

```py
line = stdout.readline()
message = json.loads(line)
```

所以 Python SDK 更像是 app-server 协议客户端，而不是 `codex exec` 包装器。

## Python SDK 如何找到 Codex binary

文件：`sdk/python/src/codex_app_server/client.py`

默认从运行时包里找：

```py
from codex_cli_bin import bundled_codex_path
```

也就是发布版本会依赖一个 pinned runtime package：

```text
openai-codex-cli-bin
```

这个包里包含对应平台的 Codex binary。

本地开发时可以通过：

```py
AppServerConfig(codex_bin="/path/to/codex")
```

显式指定 binary。

## Python SDK 的 JSON-RPC 映射

Python SDK 把高级方法映射到 app-server v2 RPC：

| SDK 方法 | JSON-RPC method |
|---|---|
| `initialize()` | `initialize` |
| `thread_start()` | `thread/start` |
| `thread_resume()` | `thread/resume` |
| `thread_list()` | `thread/list` |
| `thread_read()` | `thread/read` |
| `thread_fork()` | `thread/fork` |
| `turn_start()` | `turn/start` |
| `turn_steer()` | `turn/steer` |
| `turn_interrupt()` | `turn/interrupt` |
| `model_list()` | `model/list` |

server 也可能向 SDK 发起 request，例如审批类请求。SDK 默认通过 `approval_handler` 处理，然后写回 JSON-RPC response。

## 两个 SDK 的核心区别

| 维度 | TypeScript SDK | Python SDK |
|---|---|---|
| 启动命令 | `codex exec --experimental-json` | `codex app-server --listen stdio://` |
| 通信协议 | CLI JSONL events | JSON-RPC v2 |
| prompt 输入 | 写入 stdin | `turn/start` params |
| 事件输出 | stdout JSONL | server notifications |
| 会话继续 | `codex exec resume <thread_id>` | `thread/resume` 或同一个 app-server thread |
| 抽象层级 | 更薄，偏 CLI wrapper | 更厚，偏 app-server client |

## 简化调用链

TypeScript：

```text
Codex.startThread()
  -> Thread.run()
  -> CodexExec.run()
  -> spawn("codex", ["exec", "--experimental-json", ...])
  -> stdin 写入 prompt
  -> stdout 读取 JSONL events
  -> 聚合成 RunResult
```

Python：

```text
Codex()
  -> AppServerClient.start()
  -> Popen(["codex", "app-server", "--listen", "stdio://"])
  -> initialize
  -> thread/start
  -> turn/start
  -> 读取 notifications
  -> turn/completed 后聚合 RunResult
```

## 总结

如果你问“SDK 是不是对 Codex CLI 的包装”，答案是：

是，但要分语言看。

TypeScript SDK 基本就是对 `codex exec` 的包装。它把 SDK 方法转换成 CLI 参数，把 prompt 写进 stdin，再把 CLI 输出的 JSONL 事件转成 SDK events。

Python SDK 也是依赖 Codex CLI binary，但它不是包装 `codex exec`，而是把 Codex binary 当作 app-server 进程启动，并通过 JSON-RPC v2 操作线程、回合、流式通知和中断等能力。
