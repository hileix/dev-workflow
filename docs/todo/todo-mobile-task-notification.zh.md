# TODO: Desktop Task Notification To Mobile

## Background

当前 mobile 端能通过 backend 拉取和接收任务状态，但“桌面端主动开始一个任务后，mobile 端收到通知”这个需求还没有正式设计和实现。

## Requirement

当用户在 Desktop 端开始一个任务时，Mobile 端应该收到对应的通知或实时更新，能够知道：

- 有新任务开始了
- 任务属于哪台桌面设备
- 任务当前状态是什么
- 是否需要用户在 mobile 端继续操作

## Notes

- 这条链路不应该由 Desktop UI 直接推给 Mobile。
- 推荐继续复用现有链路：Desktop local workflow event -> connector -> backend -> mobile。
- 需要区分“任务列表实时刷新”与“系统级推送通知”两个层级。
- 如果后续要支持真正的系统通知，还需要额外设计 mobile 前台/后台、推送触达、去重和权限处理。

## Out Of Scope For Now

- 不在这次迭代实现
- 不在这次迭代设计 APNs / FCM
- 不在这次迭代补完整通知中心或消息中心
