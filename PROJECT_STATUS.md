# 项目实现状态

更新时间：2026-05-28

## 最新实现快照

- 前端 MVP 已落地在 `backend/public/index.html`，后端通过 `useStaticAssets` 直接托管，访问 `http://localhost:3000` 可进入登录和全链路页面。
- 需求录入支持两个入口：手动录入、AI 文件录入。AI 文件录入使用 `.env` 中的 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL`，并对每条拆分需求独立匹配基金客户和项目大类。
- 历史需求任务支持人工编辑和删除。编辑会同步更新 `requirements`、`requirement_items`、`tasks`；删除会软删除需求、需求项、任务、工作目录和资产记录。
- 任务指派支持飞书用户。指派并创建工作入口时，只发送一条带按钮的飞书卡片消息，员工点击后进入资产登记表。
- 资产登记表固定字段为“编号、资产地址”。员工只填写资产 URL，系统按 URL 去重统计资产个数。
- 资产提交后任务自动进入 `pending_review`，统计分析按基金客户筛选展示资产链接数、任务数、已指派任务和已开始任务。
- 已完成端到端验证：需求创建 -> 任务生成 -> 指派飞书用户 -> 飞书消息投递成功 -> 资产 URL 保存 -> 统计看板资产数更新。

## 当前关键限制

- 飞书在线表格创建当前依赖应用权限 `drive:drive`、`sheets:spreadsheet`、`sheets:spreadsheet:create`。权限未开通时会降级到本地资产表。
- 当前 `APP_PUBLIC_BASE_URL` 若为 `http://localhost:3000`，飞书移动端用户无法访问本地兜底资产表；生产环境必须配置公网地址或完成飞书在线表权限开通。
- 登录仍是 MVP 级本地登录，没有完整账号密码、RBAC 和接口鉴权。

本文档用于说明当前仓库已经实现到什么程度，方便后续继续开发、评审和部署。

## 总体结论

当前项目已经完成 MVP 骨架，并围绕最小闭环补齐了飞书通信、消息通知、需求收集、任务分配、在线资产表、资产地址同步、资产个数统计等基础能力。

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
- 新需求、需求变更、需求项确认自动通知。
- 任务逾期扫描、飞书同步失败扫描接口。

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
- 任务在线资产表登记和授权状态记录。
- 飞书资产表同步为后台资产记录。
- 本地兜底资产表保存后同步后台统计。
- 兼容旧版任务结果文件登记接口。

### 4. 项目管理与统计

- 客户、项目、用户基础 CRUD。
- 工作台概览。
- 任务看板，按资产个数展示任务产出；没有资产时显示“未开始”。
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
- 飞书云文档权限需要企业应用开通 `drive`、`sheets` 等权限；权限不足时会自动降级到本地资产表。
- 飞书消息投递依赖企业自建应用权限配置，部署前需要在飞书后台开通通讯录和 IM 消息权限。
- 定时扫描类通知目前提供手动触发接口，后续需要接入定时任务。
- 通知去重策略还未实现，定时任务上线前需要补充。
- AI 自动提取需求还未接入真实模型和飞书群消息消费流程。
- 前端管理后台尚未工程化，只保留 HTML 原型。

## 下一步建议

1. 接入真实认证和权限：登录、角色、项目可见范围、财务数据权限。
2. 完成飞书云文档权限开通：任务分配后自动创建资产表并给员工授权。
3. 增加定时任务：逾期扫描、资产表同步、同步失败提醒。
4. 前端工程化：项目列表、需求池、任务看板、消息中心、飞书配置页。
5. 接入 AI 需求提取：先把飞书群消息进入待确认需求池。
6. 完善报价适配工作台：需求项、资产地址、报价项三方核对。
