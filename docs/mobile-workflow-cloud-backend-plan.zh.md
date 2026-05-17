# Mobile Workflow Cloud Backend 方案

## 目标

让手机 App 可以在任何地点查看和控制当前电脑上的 workflow task，同时继续使用自己电脑上的开发环境执行代码、读写文件和运行 AI agent。

核心思路是新增一个部署在云服务器上的 backend，作为桌面端和手机端之间的中转层：

- Electron app 仍然在本机运行 workflow，不需要把开发环境迁移到云端。
- 本机新增一个轻量 connector，把 task 状态、phase 内容、artifact、运行事件同步到云端 backend。
- 手机 App 只负责 UI 展示和发送命令，不直接访问本机文件系统。
- 云端 backend 负责认证、状态存储、实时推送和命令转发。

## 推荐架构

```
Mobile App
   |
   | HTTPS / WebSocket
   v
Cloud Backend
   |
   | WebSocket 长连接
   v
Desktop Connector / Electron App
   |
   v
Local Workflow Runtime
```

### 组件职责

#### 1. Cloud Backend

部署在云服务器上，提供公网访问地址。

主要职责：

- 用户登录和设备认证。
- 保存 task 列表、当前状态、phase 内容和 artifact 摘要。
- 接收 desktop connector 上报的 workflow 事件。
- 向 mobile app 实时推送状态变化。
- 接收 mobile app 的命令，并转发给在线的 desktop connector。
- 记录命令执行结果，方便手机端显示成功、失败或超时。

#### 2. Desktop Connector

运行在用户自己的电脑上。

它可以有两种实现方式：

- 独立 Node 进程，连接本机已有 workflow runtime 或 server。
- 后续再集成进 Electron main process。

为了保持保守，第一版建议做成独立 Node 进程，不改 Electron app 主流程。

主要职责：

- 启动后连接 cloud backend 的 WebSocket。
- 认证当前设备。
- 监听本机 workflow task 状态。
- 把 `state`、`phase_content`、`phase_artifact`、`error` 等事件上报到 cloud backend。
- 接收云端转发过来的命令，例如 approve、reject、send message。
- 在本机调用 workflow runtime 执行命令。

#### 3. Mobile App

只做 UI 和命令入口。

主要职责：

- 展示 workfolder、task、phase 状态。
- 查看 phase 内容和 artifact。
- 对等待输入的阶段发送消息。
- 执行 approve / reject。
- 显示 desktop 是否在线。
- 显示命令发送中、执行成功、执行失败、超时等状态。

## 为什么这个方案可行

这个方案是可行的，而且比较适合当前项目。

原因：

- 当前 workflow 真正依赖的是用户电脑上的文件系统、repo、CLI、SDK 和本地配置，执行层留在电脑上是正确的。
- 手机端不适合直接运行 workflow，也不应该拿到完整本地文件权限。
- 云端 backend 不需要执行开发任务，只做状态同步和命令转发，复杂度可控。
- 通过 WebSocket 可以解决手机在公网、电脑在 NAT 或家用网络后的连接问题，因为连接由电脑主动连到云端。

## 不建议的方案

### 方案 A：让手机直接连电脑

不推荐。

问题：

- 家用网络、公司网络通常没有公网 IP。
- 需要处理 NAT、端口映射、防火墙、动态 DNS。
- 安全风险更高。

### 方案 B：把 workflow runtime 全部搬到云端

第一版不推荐。

问题：

- 云端需要复制本机开发环境、repo、密钥、CLI、agent 配置。
- 对文件系统和权限的要求更复杂。
- 和“用自己电脑的环境进行开发”的目标不一致。

## 数据流设计

### 1. 状态上报

本机 workflow 产生事件后，desktop connector 上报到 cloud backend。

示例：

```json
{
  "type": "task.event",
  "deviceId": "macbook-pro",
  "taskId": "TASK-123",
  "event": {
    "type": "state",
    "state": {
      "taskId": "TASK-123",
      "overallStatus": "awaiting_input",
      "currentPhase": "review"
    }
  }
}
```

cloud backend 保存最新状态，并推送给已连接的 mobile app。

### 2. 手机发送命令

mobile app 向 cloud backend 发送命令。

示例：

```json
{
  "type": "command.create",
  "taskId": "TASK-123",
  "command": "approve",
  "payload": {}
}
```

cloud backend 生成 `commandId`，把命令转发给对应 desktop connector。

### 3. 本机执行命令

desktop connector 收到命令后，在本机执行：

- `approveWorkflow(taskId)`
- `rejectWorkflow(taskId, rejectTo)`
- `sendWorkflowMessage(taskId, text, images)`

执行完成后回传结果。

```json
{
  "type": "command.result",
  "commandId": "CMD-456",
  "status": "ok"
}
```

如果执行失败：

```json
{
  "type": "command.result",
  "commandId": "CMD-456",
  "status": "error",
  "message": "workflow not found"
}
```

## Cloud Backend API 草案

### REST API

```txt
POST /auth/login
GET  /devices
GET  /tasks
GET  /tasks/:taskId
GET  /tasks/:taskId/phases/:phaseId/content
POST /tasks/:taskId/commands
```

### WebSocket 通道

建议分两个连接角色：

```txt
/ws/desktop
/ws/mobile
```

#### Desktop -> Backend

```txt
device.hello
task.snapshot
task.event
command.result
heartbeat
```

#### Backend -> Desktop

```txt
command.request
heartbeat
```

#### Mobile -> Backend

```txt
subscribe.tasks
subscribe.task
command.create
heartbeat
```

#### Backend -> Mobile

```txt
device.status
task.snapshot
task.event
command.status
heartbeat
```

## 数据库设计草案

第一版可以用 PostgreSQL。

### users

- `id`
- `email`
- `password_hash`
- `created_at`

### devices

- `id`
- `user_id`
- `name`
- `token_hash`
- `status`
- `last_seen_at`
- `created_at`

### tasks

- `id`
- `user_id`
- `device_id`
- `task_id`
- `work_folder`
- `overall_status`
- `current_phase`
- `state_json`
- `updated_at`
- `created_at`

### phase_contents

- `id`
- `task_id`
- `phase_id`
- `content`
- `artifact`
- `updated_at`

### commands

- `id`
- `user_id`
- `device_id`
- `task_id`
- `type`
- `payload_json`
- `status`
- `error_message`
- `created_at`
- `completed_at`

## 安全设计

第一版至少需要这些限制：

- Mobile 和 Desktop 都必须登录或使用设备 token。
- 每个 task 必须绑定 `user_id` 和 `device_id`。
- 手机端只能访问当前用户自己的设备和任务。
- 云端不保存本机 repo 文件内容，除非明确需要展示 artifact。
- 命令白名单，只允许 `approve`、`reject`、`message`、`get_content` 等 workflow 命令。
- 不允许手机端发送任意 shell 命令。
- WebSocket 连接必须使用 `wss://`。
- 设备 token 只显示一次，服务端只保存 hash。

## 第一版范围

建议第一版只做远程查看和审批，不做完整远程编辑。

### 必做

- Cloud backend 用户认证。
- Desktop connector 连接云端。
- Desktop connector 上报 task 状态。
- Mobile app 展示 task 列表和详情。
- Mobile app 实时接收 task 状态变化。
- Mobile app 支持 approve。
- Mobile app 支持发送 message。
- Desktop 在线 / 离线状态。

### 暂不做

- 手机端创建新的 workfolder。
- 手机端选择本机目录。
- 手机端直接上传本地文件参与 workflow。
- 手机端远程执行任意命令。
- 多用户协作。
- 云端运行 workflow。

## 和当前代码的关系

当前项目已经有两套类似能力：

- Electron IPC：`electron/main.mjs`、`electron/preload.cjs`、`electron/workflow-runtime.mjs`
- Local server + WebSocket：`apps/desktop/server.mjs`、`apps/desktop/local-server-controllers/wsController.mjs`

为了避免大改 Electron，建议第一版复用现有 local server 的能力：

1. 本机运行现有 Electron app。
2. 本机额外运行 `pnpm server` 或一个新的 connector 进程。
3. connector 连接本地 server 的 `/ws`，监听 workflow 事件。
4. connector 再把事件同步到 cloud backend。

后续如果要更顺滑，再把 connector 集成到 Electron main process，让 Electron 启动时自动连接云端。

## 分阶段实施计划

### Phase 1：Cloud Backend 骨架

目标：云端可以接收 desktop 连接，并给 mobile 推送在线状态。

验证：

- desktop connector 连接后，backend 记录设备在线。
- mobile 连接后，可以看到设备在线。
- desktop 断开后，mobile 可以看到设备离线。

### Phase 2：Task 状态同步

目标：手机可以看到 task 列表和详情。

验证：

- 本机 task 状态变化后，cloud backend 保存最新状态。
- mobile app 刷新后能看到最新状态。
- mobile app 保持 WebSocket 连接时能实时更新。

### Phase 3：远程命令

目标：手机可以 approve 和发送 message。

验证：

- 手机点击 approve 后，本机 workflow 进入下一阶段。
- 手机发送 message 后，本机 workflow 收到消息并继续运行。
- 命令失败时，手机能看到错误。

### Phase 4：移动端体验

目标：手机 UI 可日常使用。

验证：

- task 列表、详情、phase 内容可读。
- awaiting input 状态足够醒目。
- approve/message 的 loading 和错误状态清楚。
- 弱网重连后状态能恢复。

### Phase 5：集成进 Electron

目标：减少手动启动步骤。

验证：

- Electron 启动后自动连接 cloud backend。
- 设置页可以配置 cloud backend URL 和设备 token。
- 断网重连后能自动恢复。

## 关键风险

### 1. 本机电脑必须在线

这个方案依赖自己的电脑在线。如果电脑睡眠、断网或 app 没开，手机只能查看最后同步的状态，不能继续执行。

解决方式：

- 手机端明确显示 desktop offline。
- Electron 或 connector 尽量支持开机自启。
- 后续可以支持远程唤醒，但第一版不建议做。

### 2. 状态一致性

手机命令发出时，本机 task 可能已经进入其他 phase。

解决方式：

- 命令 payload 带上 `expectedPhase`。
- desktop 执行前校验当前 phase。
- 不匹配时拒绝命令，并返回最新 state。

### 3. 安全边界

手机端如果能远程控制本机开发环境，必须严格限制命令类型。

解决方式：

- 云端只转发 workflow 白名单命令。
- desktop connector 也做一次命令校验。
- 不提供任意 shell 执行能力。

### 4. 大内容同步

phase 内容和 artifact 可能很大。

解决方式：

- task 列表只同步摘要。
- 详情页按需加载 phase 内容。
- artifact 可以先限制大小，超出后只显示摘要或下载链接。

## 推荐技术栈

### Cloud Backend

- Node.js + Express 或 Fastify
- `ws` 或 Socket.IO
- PostgreSQL
- Redis 可选，用于多实例部署时做 pub/sub

### Desktop Connector

- Node.js
- `ws`
- 读取现有 local server WebSocket 或直接调用本地 workflow runtime

### Mobile App

使用 Flutter 实现，同时支持 iOS 和 Android。

建议依赖：

- `dio`：处理 REST API 请求。
- `web_socket_channel`：连接 cloud backend WebSocket。
- `flutter_secure_storage`：保存登录 token 和设备信息。
- `riverpod` 或 `bloc`：管理 task 状态和命令状态。
- `go_router`：管理 task 列表、详情、设置等页面路由。

第一版 Flutter 页面建议保持简单：

- 登录页。
- 设备列表页。
- Task 列表页。
- Task 详情页。
- Phase 内容页。
- 设置页。

## 最小可行版本

最小版本可以这样定义：

1. 云端 backend 支持设备连接和 mobile 连接。
2. desktop connector 上报当前 task state。
3. mobile app 展示 task state。
4. mobile app 可以发送 approve。
5. desktop connector 收到 approve 后调用本机 workflow。

只要这个闭环跑通，就证明方案成立。
