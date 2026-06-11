# 飞书联调说明

## 当前联调结论

- 飞书企业自建应用的个人消息投递已跑通，任务指派后可以向员工 `open_id` 发送卡片消息。
- 指派并创建资产入口时，系统只发送一条飞书消息，消息内包含“填写项目资产”按钮。
- 飞书在线表格创建需要应用权限：`drive:drive`、`sheets:spreadsheet`、`sheets:spreadsheet:create`。权限未开通时，飞书接口会返回 `Access denied`，系统会自动降级为本地交付登记页。
- 本地交付登记 URL 由 `APP_PUBLIC_BASE_URL` 生成，并附带任务访问 token。若配置为 `http://localhost:3000`，只有本机浏览器可访问，飞书移动端员工无法打开；生产或真实联调请配置公网 HTTPS 地址。

## 必配环境变量

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_DEFAULT_DEPARTMENT_ID=0
APP_PUBLIC_BASE_URL=https://your-public-domain.example.com
TASK_ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret
```

如需使用机器人群通知，再配置：

```env
FEISHU_BOT_WEBHOOK_URL=
FEISHU_EVENT_VERIFICATION_TOKEN=
```

## 必开飞书权限

- `im:message`
- `contact:contact.base:readonly`
- `contact:department.organize:readonly`
- `contact:contact:readonly_as_app`
- `contact:user.employee_id:readonly`
- `contact:user.name:readonly`
- `drive:drive`
- `sheets:spreadsheet`
- `sheets:spreadsheet:create`

开通权限后需要在飞书开放平台发布/启用应用权限变更，再重新测试资产表创建。

本文档用于验证 MVP 的真实飞书消息闭环：同步员工、绑定接收人、指派任务、发送交付登记入口、员工在飞书中点击按钮上传图片并填写链接。

## 当前能力

- 后端已能读取 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET`。
- `POST /api/v1/integrations/feishu/contacts/sync-users` 可以同步飞书员工到本地 `users` 表。
- 通知服务支持飞书应用个人消息。
- 如果通知携带 `actionUrl`，飞书消息会以交互卡片发送，并展示按钮。
- 任务交付通知会展示 `填写项目资产` 按钮，员工可上传多张图片并填写一个最终交付链接。

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
$login = Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/auth/login `
  -Method Post `
  -ContentType 'application/json' `
  -Body '{"username":"admin"}'

Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/users `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Method Get
```

4. 如需手动绑定某个系统用户的飞书账号：

```powershell
Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/users/<userId> `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Method Patch `
  -ContentType 'application/json' `
  -Body '{"feishuOpenId":"ou_xxx"}'
```

5. 给指定用户发送一条飞书卡片测试消息：

```powershell
$body = @{
  recipientUserId = "<userId>"
  title = "效能引擎联调测试"
  content = "如果你看到这条消息，说明飞书应用消息已打通。"
  channels = @("in_app", "feishu_app")
  actionUrl = "https://www.feishu.cn"
  actionText = "打开测试链接"
} | ConvertTo-Json -Depth 5

$utf8Body = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/notifications/send `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Method Post `
  -ContentType 'application/json; charset=utf-8' `
  -Body $utf8Body
```

6. 指派任务并开通工作目录：

```powershell
$body = @{
  assigneeUserId = "<userId>"
  provisionWorkspace = $true
  directoryUrl = "https://www.feishu.cn/drive/folder/<folderToken>"
} | ConvertTo-Json -Depth 5

$utf8Body = [System.Text.Encoding]::UTF8.GetBytes($body)

Invoke-RestMethod `
  -Uri http://localhost:3000/api/v1/tasks/<taskId>/assign `
  -Headers @{ Authorization = "Bearer $($login.accessToken)" } `
  -Method Post `
  -ContentType 'application/json; charset=utf-8' `
  -Body $utf8Body
```

员工会收到两类通知：

- 新任务通知：提示被指派任务。
- 交付登记通知：飞书卡片里包含 `填写项目资产` 按钮。

## 当前环境验证记录

- 配置状态：`appMessageAvailable=true`。
- 通讯录同步：已成功同步 3 个飞书 `open_id`。
- 后端健康检查：`GET /api/v1/health` 正常。

## 下一步

- 选择一个明确的员工 `open_id` 作为测试接收人，避免随机打扰真实员工。
- 用公网 HTTPS `APP_PUBLIC_BASE_URL` 跑通移动端点击，确认 token 链接可打开。
- 跑通一次 `任务指派 -> 飞书卡片 -> 上传图片/填写链接 -> 后台统计` 的端到端测试。
