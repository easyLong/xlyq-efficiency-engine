# 效能引擎后端

## 当前运行能力

- NestJS 后端同时提供 REST API 和 `public/` 静态 MVP 页面。
- `GET /` 进入管理端 MVP 页面，包含登录、需求录入、AI 文件录入、历史需求任务编辑/删除、任务指派、统计分析和消息记录。
- `GET /asset-sheet.html` 是员工填写资产 URL 的本地兜底资产表。
- OpenAI 兼容模型通过 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 接入，用于 AI 文件拆分和客户/项目大类匹配。
- 飞书在线资产表依赖 `drive:drive`、`sheets:spreadsheet`、`sheets:spreadsheet:create` 权限；权限不足时自动降级为本地资产表。

这是效能引擎项目的后端 MVP，基于 NestJS、TypeORM 和 MySQL 实现，负责承接项目管理、需求管理、任务管理、飞书集成、消息通知、报价适配和基础统计。

## 技术栈

- Node.js
- NestJS
- TypeScript
- TypeORM
- MySQL
- class-validator / class-transformer

## 目录结构

```text
src/
  common/            通用实体
  customers/         客户管理
  dashboard/         工作台统计
  health/            健康检查
  integrations/      飞书等外部集成
  notifications/     站内消息和飞书通知编排
  projects/          项目管理
  quote-mappings/    需求报价适配
  quotations/        报价单管理
  requirements/      需求管理
  risk-alerts/       风险预警
  tasks/             任务管理、成果目录、结果文件
  users/             用户与角色
  weekly-reports/    周报
  worklogs/          工时
```

## 环境配置

复制环境变量模板：

```bash
copy .env.example .env
```

主要配置：

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=efficiency_engine

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BOT_WEBHOOK_URL=
FEISHU_EVENT_VERIFICATION_TOKEN=
FEISHU_DEFAULT_DEPARTMENT_ID=0
```

根目录 `scripts/` 下的数据库初始化脚本复用同一组 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME` 环境变量，不再硬编码数据库账号密码。

## 启动

```bash
npm install
npm run start:dev
```

健康检查：

```text
GET http://localhost:3000/api/v1/health
```

## 常用脚本

```bash
npm run build
npm run start
npm run start:dev
npm run lint
npm run test
npm run test:e2e
```

## 主要接口模块

- `GET /api/v1/health`
- `/api/v1/customers`
- `/api/v1/projects`
- `/api/v1/requirements`
- `/api/v1/requirement-items`
- `/api/v1/tasks`
- `/api/v1/tasks/{id}/workspace`
- `/api/v1/tasks/{id}/result-files`
- `/api/v1/worklogs`
- `/api/v1/notifications`
- `/api/v1/integrations/feishu`
- `/api/v1/quotations`
- `/api/v1/quote-mappings`
- `/api/v1/risk-alerts`
- `/api/v1/weekly-reports`
- `/api/v1/users`

完整接口清单见根目录 [../API_SPEC.md](../API_SPEC.md)。

## 消息机制

消息机制由 `notifications` 模块统一编排：

- 站内消息落库：`notification_messages`
- 飞书个人消息：企业自建应用 IM 消息
- 飞书群消息：机器人 Webhook
- 投递结果记录：`delivery_result_json`、`status`、`error_message`

通知规则见根目录 [../NOTIFICATION_RULES.md](../NOTIFICATION_RULES.md)。

## 数据库

建表 SQL 见根目录 [../mysql_schema.sql](../mysql_schema.sql)。

数据模型设计说明见根目录 [../DB_SCHEMA.md](../DB_SCHEMA.md)。
