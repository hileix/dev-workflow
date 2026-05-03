# 当前 Mobile / Backend / Desktop 通信图

本文基于当前仓库代码，描述现在这套 `Mobile App -> Backend -> Desktop` 的实际通信方式。

## 结论

当前不是纯 HTTP，也不是纯 WebSocket，而是混合模式：

- `Mobile App <-> Backend`：`HTTP + WebSocket`
- `Desktop Connector <-> Backend`：`WebSocket`
- `Desktop Connector <-> Local Workflow Server`：`HTTP + WebSocket`

需要注意的是，当前远程链路里，手机并不是直接连 Electron main process。  
它实际连到的是本地的 `desktop-connector` 和 `local workflow server` 这条链路。

## 三端实际通信图

```mermaid
flowchart LR
    M[Flutter Mobile App]
    B[Cloud Backend]
    D[Desktop Connector]

    M -- "HTTP\nGET /api/tasks\nGET /api/devices\nPOST /api/tasks/:deviceId/:ticketId/commands" --> B
    B -- "HTTP Response" --> M

    M -- "WebSocket\n/ws/mobile" --> B
    B -- "bootstrap\ndevice.status\ntask.snapshot\ntask.event\ncommand.status" --> M

    D -- "WebSocket\n/ws/desktop" --> B
    B -- "device.accepted\ncommand.request" --> D
```

## Desktop 端内部实际链路

```mermaid
flowchart LR
    M[Flutter Mobile App]
    B[Cloud Backend]
    D[Desktop Connector]
    S[Local Workflow Server]
    E[Electron App]
    R[Workflow Runtime / Task State]

    M -->|HTTP + WebSocket| B
    B -->|WebSocket| D
    D -->|HTTP\n/api/workfolders\n/api/workflow\n/api/workflows\n/api/tasks/:ticketId/state| S
    D -->|WebSocket\n/ws| S
    E -. "本地 IPC" .-> R
    S --> R
```

## 当前通信职责

- `Mobile App`
  - 用 HTTP 拉任务列表和发送命令
  - 用 WebSocket 订阅实时状态

- `Backend`
  - 接收 mobile 的 HTTP 请求
  - 维护 `/ws/mobile` 和 `/ws/desktop`
  - 把 desktop 上报的任务状态推给 mobile
  - 把 mobile 发出的命令转发给 desktop connector

- `Desktop Connector`
  - 主动连接 backend 的 `/ws/desktop`
  - 从本地 server 拉取任务快照和配置
  - 通过本地 `/ws` 驱动 workflow session
  - 把本地 task 事件同步给 backend

## 主要消息流

### 1. Mobile 查看任务进度

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant B as Backend
    participant D as Desktop Connector
    participant S as Local Workflow Server

    D->>B: WebSocket connect /ws/desktop
    D->>B: device.hello
    D->>S: HTTP GET /api/tasks/:ticketId/state
    D->>B: task.snapshot / task.event

    M->>B: HTTP GET /api/tasks
    B-->>M: tasks list
    M->>B: WebSocket connect /ws/mobile
    B-->>M: bootstrap
    B-->>M: task.snapshot / task.event
```

### 2. Mobile 发送 action

```mermaid
sequenceDiagram
    participant M as Mobile App
    participant B as Backend
    participant D as Desktop Connector
    participant S as Local Workflow Server

    M->>B: HTTP POST /api/tasks/:deviceId/:ticketId/commands
    B-->>M: command created
    B-->>D: command.request

    alt approve / reject / message
        D->>S: WebSocket /ws
        D->>S: approve / reject / message
    else sync_task
        D->>S: HTTP GET /api/tasks/:ticketId/state
    else start_workflow
        D->>S: WebSocket /ws
        D->>S: start
    end

    D-->>B: command.result
    B-->>M: command.status
```

## 当前协议划分

### `Mobile App <-> Backend`

- HTTP
  - 拉任务列表
  - 拉设备列表
  - 发送命令
- WebSocket
  - 接收 `bootstrap`
  - 接收 `device.status`
  - 接收 `task.snapshot`
  - 接收 `task.event`
  - 接收 `command.status`

### `Desktop Connector <-> Backend`

- WebSocket
  - 上行消息
    - `device.hello`
    - `task.snapshot`
    - `task.event`
    - `command.result`
  - 下行消息
    - `device.accepted`
    - `command.request`

### `Desktop Connector <-> Local Workflow Server`

- HTTP
  - 读取 workflow 配置
  - 读取 workfolders
  - 读取任务状态
  - 激活 workflow
- WebSocket
  - `start`
  - `approve`
  - `reject`
  - `message`
  - 接收本地 workflow 事件

## 一句话总结

当前代码里的实际通信方式是：

```txt
Mobile App -- HTTP + WebSocket --> Backend -- WebSocket --> Desktop Connector -- HTTP + WebSocket --> Local Workflow Server
```

如果只从“三端”角度看，可以简化成：

```txt
Mobile App -- HTTP + WebSocket --> Backend -- WebSocket --> Desktop
```
