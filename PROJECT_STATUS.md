# 项目实现状态

更新时间：2026-05-27

本文档用于说明当前仓库已经实现到什么程度，方便后续继续开发、评审和部署。

## 总体结论

当前项目已经完成后端 MVP 骨架，并围绕最小闭环补齐了飞书通信、消息通知、需求收集、任务分配、任务成果目录、结果文件归档、工时记录、进度统计等基础能力。

财务报价和需求报价适配已有数据模型、接口清单和后端模块雏形，但还需要继续和真实业务规则、前端页面、权限控制、飞书审批等能力打通。

## 已完成能力

### 1. 飞书集成

- 企业自建应用 `tenant_access_token` 获取与缓存。
- 飞书通讯录员工同步到本地 `users` 表。
- 飞书应用消息发送，支持按 `open_id/user_id/union_id/email/chat_id` 投递。
- 飞书机器人 Webhook 文本消息。
- 飞书事件回调入口。
- 飞书同步日志 `feishu_sync_logs`。

主要接口：

- `GET /api/v1/integrations/feishu/config`
- `POST /api/v1/integrations/feishu/contacts/sync-users`
- `POST /api/v1/integrations/feishu/send/app-message`
- `POST /api/v1/integrations/feishu/send/bot-message`
- `POST /api/v1/integrations/feishu/webhook/events`
- `GET /api/v1/integrations/feishu/sync-logs`

### 2. 消息通知

- 站内消息表 `notification_messages`。
- 统一消息发送接口。
- 飞书个人消息和机器人消息编排。
- 任务分配自动通知。
- 任务状态变更自动通知。
- 成果文件提交自动通知。
- 新需求、需求变更、需求项确认自动通知。
- 任务逾期扫描、工时未提交提醒、飞书同步失败扫描接口。

主要接口：

- `GET /api/v1/notifications`
- `POST /api/v1/notifications/send`
- `POST /api/v1/notifications/task-assignment`
- `POST /api/v1/notifications/task-deadline-scan`
- `POST /api/v1/notifications/worklog-reminders`
- `POST /api/v1/notifications/feishu-sync-failure-scan`
- `POST /api/v1/notifications/{id}/read`

### 3. 需求与任务主链路

- 手工创建和编辑需求。
- 需求项创建、编辑、确认、废弃。
- 从需求项生成任务。
- 任务创建、编辑、分配、状态更新。
- 任务成果目录登记和授权状态记录。
- 任务结果文件登记。
- 工时记录、提交、审批、删除。
- 工时变更后回写任务实际工时。

### 4. 项目管理与统计

- 客户、项目、用户基础 CRUD。
- 工作台概览。
- 任务看板。
- 风险提醒模块。
- 周报模块。
- 报价单和需求报价映射模块雏形。

### 5. 数据库与文档

- MySQL 建表脚本：`mysql_schema.sql`。
- 数据库设计说明：`DB_SCHEMA.md`。
- API 清单：`API_SPEC.md`。
- 通知规则：`NOTIFICATION_RULES.md`。
- MVP 范围：`MVP_SCOPE.md`。

## 当前验证结果

最近一次功能开发后已执行：

```bash
npm run build
npm run test -- --runInBand
```

结果：通过。

## 当前限制

- 认证和权限控制仍是 MVP 雏形，还没有完整 RBAC、登录态和接口鉴权。
- 飞书目录授权目前记录为业务状态，真实云文档权限 API 还未完全接入。
- 飞书消息投递依赖企业自建应用权限配置，部署前需要在飞书后台开通通讯录和 IM 消息权限。
- 定时扫描类通知目前提供手动触发接口，后续需要接入定时任务。
- 通知去重策略还未实现，定时任务上线前需要补充。
- AI 自动提取需求还未接入真实模型和飞书群消息消费流程。
- 前端管理后台尚未工程化，只保留 HTML 原型。

## 下一步建议

1. 接入真实认证和权限：登录、角色、项目可见范围、财务数据权限。
2. 完成飞书云文档目录授权：任务分配后自动给员工授权目录。
3. 增加定时任务：逾期扫描、工时提醒、同步失败提醒。
4. 做前端 MVP：项目列表、需求池、任务看板、消息中心、飞书配置页。
5. 接入 AI 需求提取：先把飞书群消息进入待确认需求池。
6. 完善报价适配工作台：需求项、任务工时、报价项三方核对。
