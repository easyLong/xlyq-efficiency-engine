# 效能引擎后端

更新时间：2026-06-04

这是效能引擎的 NestJS 后端服务，同时托管当前 MVP 静态页面。

## 运行入口

- 管理端：`GET http://localhost:3000/`
- 本地资产表：`GET http://localhost:3000/asset-sheet.html`
- API Base：`http://localhost:3000/api/v1`
- 健康检查：`GET /api/v1/health`

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
  contact-contexts/  对接人维度配置
  customers/         客户管理
  dashboard/         工作台统计
  health/            健康检查
  integrations/      飞书等外部集成
  notifications/     站内消息和飞书通知编排
  projects/          项目管理
  quote-mappings/    需求任务与报价子项映射
  quotations/        报价单和报价子项
  requirements/      需求管理
  risk-alerts/       风险预警
  tasks/             任务、工作入口、资产记录
  users/             用户与角色
  weekly-reports/    周报
  worklogs/          工时
public/
  index.html         MVP 管理端
  asset-sheet.html   本地兜底资产表
scripts/
  migrate-project-tables.js
```

## 环境配置

复制环境变量模板：

```bash
copy .env.example .env
```

主要配置：

```env
PORT=3000
APP_PUBLIC_BASE_URL=http://localhost:3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=ops_platform

FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BOT_WEBHOOK_URL=
FEISHU_EVENT_VERIFICATION_TOKEN=
FEISHU_DEFAULT_DEPARTMENT_ID=0

OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

## 启动

开发模式：

```bash
npm install
npm run start:dev
```

生产模式：

```bash
npm run build
npm run start:prod
```

## 常用脚本

```bash
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run start:dev
npm run start:prod
npm run migrate:project-tables -- --help
```

注意：`npm run lint` 当前带 `--fix`，会自动改动文件；做纯检查时需谨慎使用。

## 主要 API 模块

- `GET /api/v1/health`
- `/api/v1/users`
- `/api/v1/customers`
- `/api/v1/contact-contexts`
- `/api/v1/projects`
- `/api/v1/requirements`
- `/api/v1/requirement-items`
- `/api/v1/tasks`
- `/api/v1/notifications`
- `/api/v1/integrations/feishu`
- `/api/v1/quotations`
- `/api/v1/quote-mappings`
- `/api/v1/risk-alerts`
- `/api/v1/weekly-reports`
- `/api/v1/worklogs`

完整接口清单见 [../API_SPEC.md](../API_SPEC.md)。

## 数据链路说明

关键链路见 [../DATA_FLOW.md](../DATA_FLOW.md)。

后端已经对以下链路做一致性保护：

- 删除报价单/报价子项会清理相关报价映射和报价子项维度规则。
- 删除需求会清理需求项、任务、资产记录和报价映射。
- 报价映射创建/更新会校验需求客户、报价单客户和报价子项归属，避免跨基金挂错报价。
- 报价子项状态只按有效映射回算，`rejected`、`obsolete` 不再占用报价子项。

## 数据库与迁移

建表 SQL 见 [../mysql_schema.sql](../mysql_schema.sql)。

跨库迁移脚本：

```bash
npm run migrate:project-tables -- --help
npm run migrate:project-tables -- --execute
```

源库默认读取 `backend/.env` 的 `DB_*`，目标库通过 `TARGET_DB_NAME` 指定。

## 飞书与模型

- OpenAI 兼容模型用于需求文件拆分、客户/业务分类识别、报价单解析。
- 飞书在线表格依赖 `drive:drive`、`sheets:spreadsheet`、`sheets:spreadsheet:create` 权限。
- 权限不足时，任务指派会降级到本地资产表。
- 移动端员工访问本地资产表时，`APP_PUBLIC_BASE_URL` 必须是公网可访问地址。
