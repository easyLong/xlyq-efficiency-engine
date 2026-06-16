# 向量引擎管理工作台后端

更新时间：2026-06-16

这是向量引擎管理工作台的 NestJS 后端服务，同时托管当前 MVP 静态页面。

## 运行入口

- 管理端：`GET http://localhost:3000/`
- 本地交付登记页：`GET http://localhost:3000/asset-sheet.html?taskId=<taskId>&taskNo=<taskNo>&token=<token>`
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
  ai-prompts/        AI 提示词注册表和版本管理
  contact-contexts/  对接人配置，维护基金客户和业务平台
  customers/         客户管理
  dimensions/        业务维度字典和大类二级分类关系
  dashboard/         需求面板统计
  health/            健康检查
  integrations/      飞书等外部集成
  notifications/     站内消息和飞书通知编排
  projects/          项目管理
  quote-mappings/    需求任务与报价子项映射
  quotations/        合同报价和报价子项
  requirements/      需求管理
  risk-alerts/       风险预警
  tasks/             任务、工作入口、资产记录
  users/             用户与角色
  weekly-reports/    周报
  worklogs/          工时
public/
  index.html         MVP 管理端
  asset-sheet.html   本地交付登记页
  js/                管理端静态 JS 模块
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
HOST=0.0.0.0
APP_PUBLIC_BASE_URL=http://localhost:3000
TASK_ACCESS_TOKEN_SECRET=replace-with-a-long-random-secret

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

局域网访问时建议配置：

```env
PORT=9000
HOST=0.0.0.0
APP_PUBLIC_BASE_URL=http://<本机局域网IP>:9000
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
- `GET /api/v1/auth/login-users`
- `POST /api/v1/auth/login`
- `/api/v1/users`
- `/api/v1/customers`
- `/api/v1/contact-contexts`
- `/api/v1/dimensions`
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

管理端接口默认需要 `Authorization: Bearer <accessToken>`；`/api/v1/health`、`/api/v1/auth/login-users`、`/api/v1/auth/login`、飞书事件回调和带任务 token 的交付登记接口是公开入口。

## 数据链路说明

关键链路见 [../DATA_FLOW.md](../DATA_FLOW.md)。

后端已经对以下链路做一致性保护：

- 删除报价单/报价子项会清理相关报价映射和报价子项维度规则。
- 删除需求会清理需求项、任务、资产记录和报价映射。
- 报价映射保存会校验需求客户、报价单客户和报价子项归属，避免跨基金挂错报价；同一需求项重复保存会复用当前映射并将旧有效映射标记为 `obsolete`。
- 报价子项状态只按有效映射回算，`rejected`、`obsolete` 不再占用报价子项。
- 本地交付登记保存、需求删除、报价单删除使用事务，避免资产、任务、映射残留。
- 资产个数只统计图片资产和人工登记资产；最终交付链接仅用于追踪，不参与结算数量。
- 服务启动时会通过 `common/schema-maintenance.ts` 安全补齐高频查询索引，降低历史需求、结算统计、报价映射等页面的查询压力。

## 数据库与迁移

建表 SQL 见 [../mysql_schema.sql](../mysql_schema.sql)。

跨库迁移脚本：

```bash
npm run migrate:project-tables -- --help
npm run migrate:project-tables -- --execute
```

源库默认读取 `backend/.env` 的 `DB_*`，目标库通过 `TARGET_DB_NAME` 指定。

## 飞书与模型

- OpenAI 兼容模型用于需求文件拆分、客户/业务分类识别、合同报价解析。
- 飞书在线表格依赖 `drive:drive`、`sheets:spreadsheet`、`sheets:spreadsheet:create` 权限。
- 权限不足时，任务指派会降级到本地交付登记页。
- 移动端员工访问本地交付登记页时，`APP_PUBLIC_BASE_URL` 必须是公网可访问地址。

## 2026-06-11 模块化更新

- `tasks/task-status.ts`：任务状态机和状态流转校验。
- `tasks/task-workflow.ts`：任务 workflow 快照，供后台看板、资产登记页、通知流程统一判断下一步。
- `integrations/feishu/feishu-openapi.client.ts`：飞书 OpenAPI token 和请求封装。
- `integrations/feishu/feishu-sheet.client.ts`：飞书资产表创建、授权、读取。
- `integrations/feishu/feishu-task-card-action.handler.ts`：飞书卡片按钮回调业务处理。
- `integrations/feishu/feishu-user-sync.service.ts`：飞书员工同步。
- `ai-prompts/prompt-registry.ts`：需求识别、需求拆分、报价解析提示词版本管理。

## 2026-06-15 数据架构更新

- `dimensions/entities/business-category-secondary-category.entity.ts`：业务大类与二级分类关系表。
- `common/schema-maintenance.ts`：启动期安全补齐索引。
- `quote-mappings/quote-mappings.service.ts`：报价映射幂等保存，旧有效映射置为 `obsolete`。
- `requirements/requirements.service.ts`：历史看板完整拉取最新需求下的子项、任务、报价映射。
- `quotations/quotations.service.ts`：CSV 合同报价优先按结构化表格解析最细粒度子项、单位和单价。
