# 飞书联调说明

本文档用于验证 MVP 的真实飞书消息闭环：同步员工、绑定接收人、指派任务、开通任务工作目录、员工在飞书中点击按钮进入目录。

## 当前能力

- 后端已能读取 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`。
- `POST /api/v1/integrations/feishu/contacts/sync-users` 可以同步飞书员工到本地 `users` 表。
- 通知服务支持飞书应用个人消息。
- 如果通知携带 `actionUrl`，飞书消息会以交互卡片发送，并展示按钮。
- 任务工作目录开通通知会展示 `进入工作目录` 按钮。

## 推荐飞书权限

飞书开放平台应用需要开通并发布以下权限：

- `im:message`
- `contact:contact.base:readonly`
- `contact:department.organize:readonly`
- `contact:contact:readonly_as_app`
- `contact:user.employee_id:readonly`

如果希望通过员工工号或 `user_id` 发送消息，需要开通 `contact:user.employee_id:readonly`。如果希望同步员工姓名、邮箱、手机号等资料，还需要继续补充对应字段权限。当前环境已可同步 `open_id`，但如果飞书只返回 `open_id`，说明员工展示信息权限还不完整。

## 联调步骤

1. 检查飞书配置状态：

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/v1/integrations/feishu/config -Method Get
```

2. 同步飞书员工：

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/integrations/feishu/contacts/sync-users `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"departmentId":"0","pageSize":50}'
```

3. 查看本地用户，确认要测试的接收人：

```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/v1/users -Method Get
```

4. 如需手动绑定某个系统用户的飞书账号：

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/users/<userId> `
  -Method Patch `
  -ContentType 'application/json' `
  -Body '{"feishuOpenId":"ou_xxx"}'
```

5. 给指定用户发送一条飞书卡片测试消息：

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/notifications/send `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{
    "recipientUserId":"<userId>",
    "title":"效能引擎联调测试",
    "content":"如果你看到这条消息，说明飞书应用消息已打通。",
    "channels":["in_app","feishu_app"],
    "actionUrl":"https://www.feishu.cn",
    "actionText":"打开测试链接"
  }'
```

6. 指派任务并开通工作目录：

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/tasks/<taskId>/assign `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{
    "assigneeUserId":"<userId>",
    "provisionWorkspace":true,
    "directoryUrl":"https://www.feishu.cn/drive/folder/<folderToken>"
  }'
```

员工会收到两类通知：

- 新任务通知：提示被指派任务。
- 工作目录通知：飞书卡片里包含 `进入工作目录` 按钮。

## 当前环境验证记录

- 配置状态：`appMessageAvailable=true`。
- 通讯录同步：已成功同步 3 个飞书 `open_id`。
- 后端健康检查：`GET /api/v1/health` 正常。

## 下一步

- 选择一个明确的员工 `open_id` 作为测试接收人，避免随机打扰真实员工。
- 用真实飞书云文档目录 URL 替换示例 `directoryUrl`。
- 跑通一次 `任务指派 -> 目录授权 -> 飞书卡片 -> 点击进入目录` 的端到端测试。
