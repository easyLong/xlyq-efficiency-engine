# 效能引擎后端接口设计 API 清单

## 1. 文档目标

本文档定义效能引擎 V1 的后端 REST API 清单，供前后端联调、权限设计和服务拆分使用。

## 2. 设计约定

- 协议：HTTPS
- 风格：RESTful + 少量动作型接口
- Base Path：`/api/v1`
- 鉴权：`Authorization: Bearer <token>`
- 返回格式：JSON
- 时间格式：ISO 8601
- 主键类型：UUID 字符串

统一响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

分页响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

## 3. 认证与用户

## 3.1 认证

### `POST /auth/login`
- 说明：账号密码登录
- 入参：`username`、`password`
- 出参：`accessToken`、`refreshToken`、`user`

### `POST /auth/feishu/login`
- 说明：飞书登录
- 入参：`code`
- 出参：`accessToken`、`refreshToken`、`user`

### `POST /auth/refresh`
- 说明：刷新 Token
- 入参：`refreshToken`
- 出参：`accessToken`

### `POST /auth/logout`
- 说明：登出

## 3.2 用户

### `GET /users/me`
- 说明：获取当前用户信息

### `GET /users`
- 说明：获取用户列表
- 权限：管理员 / 管理者 / 项目经理
- 查询：`keyword`、`status`、`roleCode`

### `GET /users/{userId}`
- 说明：获取用户详情

### `POST /users`
- 说明：创建用户

### `PATCH /users/{userId}`
- 说明：更新用户

### `GET /roles`
- 说明：获取角色列表

## 4. 工作台

### `GET /dashboard/overview`
- 说明：获取首页工作台数据
- 权限：登录用户
- 返回：
  - 进行中项目数
  - 待处理任务数
  - 逾期任务数
  - 待适配项数量
  - 待审核报价单数量
  - 本月收入 / 待结算金额

### `GET /dashboard/alerts`
- 说明：获取 AI 风险提醒和待办

### `GET /dashboard/metrics`
- 说明：获取经营指标卡片

## 5. 客户管理

### `GET /customers`
- 说明：客户列表
- 查询：`keyword`、`status`

### `POST /customers`
- 说明：创建客户

### `GET /customers/{customerId}`
- 说明：客户详情

### `PATCH /customers/{customerId}`
- 说明：更新客户

### `GET /customers/{customerId}/projects`
- 说明：查询客户下项目

## 6. 项目管理

### `GET /projects`
- 说明：项目列表
- 查询：`status`、`ownerUserId`、`customerId`、`keyword`

### `POST /projects`
- 说明：创建项目
- 关键字段：
  - `projectName`
  - `customerId`
  - `ownerUserId`
  - `projectType`
  - `budgetAmount`
  - `plannedEndDate`

### `GET /projects/{projectId}`
- 说明：项目详情

### `PATCH /projects/{projectId}`
- 说明：更新项目

### `POST /projects/{projectId}/archive`
- 说明：归档项目

### `GET /projects/{projectId}/overview`
- 说明：项目总览
- 返回：
  - 基础信息
  - 需求统计
  - 任务统计
  - 风险摘要
  - 报价摘要

### `GET /projects/{projectId}/members`
- 说明：项目成员列表

### `POST /projects/{projectId}/members`
- 说明：添加项目成员

### `DELETE /projects/{projectId}/members/{memberId}`
- 说明：移除项目成员

## 7. 需求管理

### `GET /requirements`
- 说明：需求列表
- 查询：`projectId`、`customerId`、`status`、`priority`、`sourceType`、`keyword`

### `POST /requirements`
- 说明：创建需求
- 关键字段：
  - `projectId`
  - `customerId`
  - `title`
  - `sourceType`
  - `rawContent`

### `GET /requirements/{requirementId}`
- 说明：需求详情

### `PATCH /requirements/{requirementId}`
- 说明：更新需求基础信息

### `POST /requirements/{requirementId}/parse`
- 说明：触发 AI 需求解析
- 返回：
  - `aiLogId`
  - `structuredResult`

### `POST /requirements/{requirementId}/confirm`
- 说明：确认需求与结构化结果

### `GET /requirements/{requirementId}/versions`
- 说明：需求版本列表

### `POST /requirements/{requirementId}/versions`
- 说明：新增需求版本

## 8. 需求项管理

### `GET /requirement-items`
- 说明：需求项列表
- 查询：`requirementId`、`projectId`、`status`、`quoteScopeStatus`

### `POST /requirements/{requirementId}/items`
- 说明：新增需求项

### `PATCH /requirement-items/{itemId}`
- 说明：更新需求项

### `POST /requirement-items/{itemId}/confirm`
- 说明：确认需求项

### `POST /requirement-items/{itemId}/obsolete`
- 说明：废弃需求项

### `GET /requirement-items/{itemId}/mappings`
- 说明：查看需求项关联报价映射

## 9. 任务管理

### `GET /tasks`
- 说明：任务列表
- 查询：`projectId`、`assigneeUserId`、`status`、`requirementItemId`、`keyword`

### `POST /tasks`
- 说明：创建任务

### `POST /requirement-items/{itemId}/tasks`
- 说明：从需求项生成任务

### `GET /tasks/{taskId}`
- 说明：任务详情

### `PATCH /tasks/{taskId}`
- 说明：更新任务

### `POST /tasks/{taskId}/assign`
- 说明：指派任务，可选同步创建任务成果目录授权记录
- 入参：`assigneeUserId`、`provisionWorkspace`、`feishuFolderToken`、`directoryUrl`

### `GET /tasks/{taskId}/workspace`
- 说明：获取任务成果目录和权限状态

### `POST /tasks/{taskId}/workspace/provision`
- 说明：创建或更新任务成果目录授权记录
- 入参：`assigneeUserId`、`feishuFolderToken`、`directoryUrl`

### `GET /tasks/{taskId}/result-files`
- 说明：获取任务结果文件列表

### `POST /tasks/{taskId}/result-files`
- 说明：登记任务结果文件
- 入参：`fileName`、`fileUrl`、`feishuFileToken`、`uploadedByUserId`、`remark`

### `POST /tasks/{taskId}/status`
- 说明：修改任务状态
- 入参：`status`、`blockedReason`

### `POST /tasks/{taskId}/ai-assignment-suggestion`
- 说明：生成 AI 智能分配建议

### `GET /tasks/board`
- 说明：看板视图
- 查询：`projectId`

### `GET /tasks/my`
- 说明：我的任务

## 10. 工时管理

### `GET /worklogs`
- 说明：工时列表
- 查询：`projectId`、`taskId`、`userId`、`dateFrom`、`dateTo`

### `POST /worklogs`
- 说明：新增工时

### `PATCH /worklogs/{worklogId}`
- 说明：编辑工时

### `DELETE /worklogs/{worklogId}`
- 说明：删除工时

### `POST /worklogs/{worklogId}/submit`
- 说明：提交工时

### `POST /worklogs/{worklogId}/approve`
- 说明：审批工时

## 11. 风险与周报

### `GET /risk-alerts`
- 说明：风险列表
- 查询：`projectId`、`status`、`severity`、`alertType`

### `POST /risk-alerts/detect`
- 说明：触发风险扫描
- 入参：`projectId`

### `POST /risk-alerts/{alertId}/acknowledge`
- 说明：确认风险

### `POST /risk-alerts/{alertId}/resolve`
- 说明：关闭风险

### `GET /weekly-reports`
- 说明：周报列表
- 查询：`projectId`、`reportWeek`、`status`

### `POST /weekly-reports/generate`
- 说明：AI 生成周报
- 入参：`projectId`、`reportWeek`

### `GET /weekly-reports/{reportId}`
- 说明：周报详情

### `PATCH /weekly-reports/{reportId}`
- 说明：编辑周报

### `POST /weekly-reports/{reportId}/send-feishu`
- 说明：发送周报到飞书

## 12. 需求报价适配

### `GET /quote-mappings/workbench`
- 说明：适配工作台数据
- 查询：`projectId`
- 返回：
  - 需求项列表
  - 任务与工时统计
  - 当前映射状态统计
  - 当前报价单草稿

### `POST /quote-mappings/suggest`
- 说明：生成需求报价适配建议
- 入参：`projectId`
- 返回：`aiLogId`、`mappingSuggestions`

### `GET /quote-mappings`
- 说明：映射列表
- 查询：`projectId`、`requirementItemId`、`mappingStatus`

### `POST /quote-mappings`
- 说明：手工创建映射

### `PATCH /quote-mappings/{mappingId}`
- 说明：修改映射

### `POST /quote-mappings/{mappingId}/confirm`
- 说明：财务确认映射

### `POST /quote-mappings/batch-confirm`
- 说明：批量确认映射

### `GET /quote-mappings/diff`
- 说明：查看未匹配项 / 差异项
- 查询：`projectId`

## 13. 报价单管理

### `GET /quotations`
- 说明：报价单列表
- 查询：`projectId`、`customerId`、`status`、`quotationNo`

### `POST /quotations`
- 说明：手工创建报价单

### `POST /quotations/from-mappings`
- 说明：根据映射结果生成报价单草稿
- 入参：`projectId`、`mappingIds[]`

### `GET /quotations/{quotationId}`
- 说明：报价单详情

### `PATCH /quotations/{quotationId}`
- 说明：更新报价单头信息

### `POST /quotations/{quotationId}/items`
- 说明：新增报价项

### `PATCH /quotation-items/{quotationItemId}`
- 说明：修改报价项

### `DELETE /quotation-items/{quotationItemId}`
- 说明：删除报价项

### `POST /quotations/{quotationId}/submit-review`
- 说明：提交审核

### `POST /quotations/{quotationId}/review`
- 说明：财务审核
- 入参：`approved`、`remark`

### `POST /quotations/{quotationId}/confirm-customer`
- 说明：标记客户已确认

### `POST /quotations/{quotationId}/export`
- 说明：导出报价单
- 返回：文件地址或任务ID

### `POST /quotations/{quotationId}/send-feishu`
- 说明：发送报价单到飞书

## 14. 变更单管理

### `GET /change-requests`
- 说明：变更单列表
- 查询：`projectId`、`status`、`changeType`

### `POST /change-requests`
- 说明：创建变更单

### `GET /change-requests/{changeRequestId}`
- 说明：变更单详情

### `PATCH /change-requests/{changeRequestId}`
- 说明：更新变更单

### `POST /change-requests/{changeRequestId}/assess`
- 说明：评估变更影响
- 返回：
  - 受影响需求项
  - 受影响任务
  - 受影响报价项
  - 金额差异

### `POST /change-requests/{changeRequestId}/confirm`
- 说明：确认变更单生效

### `GET /change-requests/{changeRequestId}/items`
- 说明：变更影响明细

## 15. 飞书集成

### `GET /integrations/feishu/config`
- 说明：获取飞书配置状态

### `POST /integrations/feishu/send/bot-message`
- 说明：发送机器人消息
- 入参：`text`、`objectType`、`objectId`、`feishuObjectType`、`feishuObjectId`

### `POST /integrations/feishu/send/app-message`
- 说明：通过企业自建应用向员工或群发送消息
- 入参：`receiveIdType`、`receiveId`、`text`、`objectType`、`objectId`
- 备注：`receiveIdType` 支持 `open_id/user_id/union_id/email/chat_id`

### `POST /integrations/feishu/contacts/sync-users`
- 说明：从飞书通讯录同步员工到本地用户表
- 入参：`departmentId`、`pageSize`
- 备注：默认从 `FEISHU_DEFAULT_DEPARTMENT_ID` 同步，根部门通常为 `0`

### `POST /integrations/feishu/webhook/events`
- 说明：飞书事件回调入口

### `GET /integrations/feishu/sync-logs`
- 说明：同步日志列表
- 查询：`objectType`、`objectId`、`status`

## 16. AI 助手

### `GET /ai/logs`
- 说明：AI 执行日志列表
- 查询：`sceneCode`、`projectId`、`objectType`

### `GET /ai/logs/{aiLogId}`
- 说明：AI 日志详情

### `POST /ai/requirement-parse`
- 说明：通用需求解析接口

### `POST /ai/task-assignment`
- 说明：通用任务分配建议接口

### `POST /ai/risk-detect`
- 说明：通用风险识别接口

### `POST /ai/quote-mapping`
- 说明：通用需求报价适配接口

### `POST /ai/quote-draft`
- 说明：通用报价草稿建议接口

### `POST /ai/suggestions/{aiLogId}/accept`
- 说明：记录 AI 建议采纳

### `POST /ai/suggestions/{aiLogId}/reject`
- 说明：记录 AI 建议拒绝

## 17. 审计与通用

### `GET /audit-logs`
- 说明：审计日志列表
- 查询：`objectType`、`objectId`、`operatorUserId`

### `GET /enum/options`
- 说明：获取前端所需状态枚举

### `GET /health`
- 说明：健康检查

## 18. 核心对象最小响应字段

## 18.1 Project

```json
{
  "id": "uuid",
  "projectCode": "PRJ-202605-001",
  "projectName": "商城改版项目",
  "status": "in_progress",
  "customerId": "uuid",
  "ownerUserId": "uuid",
  "budgetAmount": 90000.00,
  "plannedEndDate": "2026-06-30"
}
```

## 18.2 RequirementItem

```json
{
  "id": "uuid",
  "requirementId": "uuid",
  "itemNo": "REQ-ITEM-01",
  "itemTitle": "商城首页改版",
  "status": "confirmed",
  "quoteScopeStatus": "in_scope",
  "estimatedHours": 32.00
}
```

## 18.3 Quotation

```json
{
  "id": "uuid",
  "quotationNo": "QT-202605-001",
  "projectId": "uuid",
  "status": "pending_review",
  "pricingBasis": "mapping",
  "totalAmount": 86800.00,
  "versionNo": 1
}
```

## 19. 推荐开发顺序

1. `auth`、`users`、`projects`
2. `requirements`、`requirement-items`
3. `tasks`、`worklogs`
4. `quote-mappings`
5. `quotations`
6. `change-requests`
7. `feishu integrations`
8. `ai logs`、`audit logs`

## 20. 消息通知接口

### `GET /notifications`
- 说明：消息列表
- 查询：`recipientUserId`、`status`

### `GET /notifications/{notificationId}`
- 说明：消息详情

### `POST /notifications/send`
- 说明：发送业务消息，默认写站内消息并尝试发送飞书应用消息
- 入参：`recipientUserId`、`title`、`content`、`objectType`、`objectId`、`channels`、`botText`
- 渠道：`in_app`、`feishu_app`、`feishu_bot`

### `POST /notifications/task-assignment`
- 说明：手动触发任务分配通知
- 入参：`taskId`、`message`

### `POST /notifications/{notificationId}/read`
- 说明：标记消息已读

### `POST /notifications/task-deadline-scan`
- 说明：扫描即将逾期和已逾期任务并发送提醒
- 入参：`projectId`、`daysAhead`

### `POST /notifications/worklog-reminders`
- 说明：扫描未提交工时的任务并提醒负责人
- 入参：`projectId`、`workDate`

### `POST /notifications/feishu-sync-failure-scan`
- 说明：扫描飞书同步失败日志并提醒管理员
- 入参：`hours`
