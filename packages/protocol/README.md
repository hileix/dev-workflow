# @dev-workflow/protocol

Shared protocol contracts for the daemon-server-web architecture.

This package captures the REST/WebSocket surface shared by the web app, stateless relay server, and local daemon.

## Current REST Contracts

| Owner | Endpoint | Purpose |
| --- | --- | --- |
| Relay server | `GET /api/devices` | Connected daemon list. |
| Relay server | `GET /api/tasks` | Aggregated task snapshots proxied from connected daemons. |
| Relay server | `GET /api/workflow` | Active workflow config proxied from the daemon. |
| Relay server | `GET /api/workflows` | Workflow list proxied from the daemon. |
| Relay server | `GET /api/workflows/:filename` | Workflow definition lookup proxied from the daemon. |
| Relay server | `POST /api/workflows` | Create daemon-owned workflow through a daemon query. |
| Relay server | `PUT /api/workflows/:filename` | Edit daemon-owned workflow through a daemon query. |
| Relay server | `PUT /api/workflows/:filename/activate` | Activate daemon-owned workflow through a daemon query. |
| Relay server | `GET /api/workfolders` | Work folder list proxied from the daemon. |
| Relay server | `POST /api/workfolders` | Add a local daemon work folder. |
| Relay server | `DELETE /api/workfolders` | Remove a local daemon work folder. |
| Relay server | `GET /api/tasks/:taskId/state` | Local task state proxied from the daemon. |
| Relay server | `DELETE /api/tasks/:taskId` | Route task deletion command to the daemon. |
| Relay server | `POST /api/tasks/:runId/upload` | Save task upload files through the daemon. |
| Relay server | `GET /api/tasks/:deviceId/:taskId` | Task snapshot lookup through a daemon query. |
| Relay server | `POST /api/tasks/:deviceId/:taskId/commands` | Route UI commands to the owning daemon. |

## Current WebSocket Contracts

| Channel | Message | Direction | Purpose |
| --- | --- | --- | --- |
| Relay `/ws/daemon` | `daemon.hello` | daemon -> server | Daemon registration and metadata publish. |
| Relay `/ws/daemon` | `daemon.accepted` | server -> daemon | Daemon registration acknowledgement. |
| Relay `/ws/daemon` | `query.request` | server -> daemon | Request daemon-owned data such as task snapshots. |
| Relay `/ws/daemon` | `query.response` | daemon -> server | Return daemon-owned query data. |
| Relay `/ws/daemon` | `command.request` | server -> daemon | Route a UI command to the daemon. |
| Relay `/ws/daemon` | `command.result` | daemon -> server | Report routed command result. |
| Relay `/ws/daemon` | `task.snapshot` | daemon -> server | Publish latest task snapshot. |
| Relay `/ws/daemon` | `task.event` | daemon -> server | Forward local workflow event. |
| Relay `/ws/daemon` | `task.removed` | daemon -> server | Notify task removal. |
| Relay `/ws/ui` | `bootstrap` | server -> web | Initial devices and tasks. |
| Relay `/ws/ui` | `task.event` | server -> web | Task runtime event. |
| Relay `/ws/ui` | `command.status` | server -> web | Command pending/ok/error update. |

## Identity Model

- `deviceId` identifies the daemon connection.
- `taskId` may still be daemon-local.
- UI task keys use `deviceId:taskId`.
- `runId` identifies a task execution attempt and maps to daemon JSON storage.

Target model:

- new daemon-created tasks use globally unique daemon-generated `taskId` values, such as `nanoid`.
- `deviceId` remains available for routing and ownership.
- existing task IDs are not rewritten unless a separate migration requires it.
