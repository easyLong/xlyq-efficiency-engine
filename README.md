# 效能引擎

效能引擎是一套面向项目制团队的 AI 项目管理软件。当前仓库已落地后端 MVP，核心目标是把客户需求收集、任务分配、进度跟进、成果归档、飞书通知、报价适配和财务结算串成可追踪的业务闭环。

项目的关键业务特点是：项目部按需求和任务推进，财务侧按报价单结算。因此系统需要在“需求项、任务、成果文件、报价项”之间建立可审核、可追踪、可调整的映射关系。

## 当前状态

- 后端技术栈：NestJS + TypeORM + MySQL。
- 飞书能力：企业自建应用消息、机器人消息、通讯录同步、事件回调、同步日志。
- 消息机制：站内消息、飞书个人消息、飞书群机器人消息、投递状态记录。
- MVP 主链路：手工需求录入 -> 需求项确认 -> 任务生成与分配 -> 目录权限记录 -> 成果文件提交 -> 进度统计与通知。
- 已验证：`npm run build`、`npm run test -- --runInBand`。

详细实现状态见 [PROJECT_STATUS.md](PROJECT_STATUS.md)。

## 文档导航

建议先看“状态与范围”，再看产品、数据库和接口设计。

| 文档 | 用途 |
| --- | --- |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | 当前实现状态、已完成功能、待办和验证结果 |
| [MVP_SCOPE.md](MVP_SCOPE.md) | 第一版最小 MVP 范围和验收闭环 |
| [NOTIFICATION_RULES.md](NOTIFICATION_RULES.md) | 消息通知规则、触发场景和渠道策略 |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | 项目整体规划、业务目标、MVP 范围、实施路线 |
| [PRD.md](PRD.md) | 产品需求文档，包含角色、场景、功能范围和业务流程 |
| [DB_SCHEMA.md](DB_SCHEMA.md) | 数据库表结构设计说明 |
| [mysql_schema.sql](mysql_schema.sql) | MySQL 建库建表 SQL |
| [API_SPEC.md](API_SPEC.md) | 后端 REST API 清单 |
| [DIAGRAMS.md](DIAGRAMS.md) | ER 图、模块关系图、核心流程图 |
| [backend/README.md](backend/README.md) | 后端服务启动、环境变量和接口模块说明 |
| [pm_dashboard_prototype.html](pm_dashboard_prototype.html) | 项目管理工作台 HTML 原型 |
| [pm_workflow_diagram.svg](pm_workflow_diagram.svg) | 项目流程图 SVG |

## 最小 MVP 主线

```text
飞书员工同步 / 手工用户维护
  -> 手工录入客户需求
  -> 拆分并确认需求项
  -> 从需求项生成任务
  -> 分配任务给员工
  -> 登记任务成果目录和权限状态
  -> 员工更新进度、登记工时、提交成果文件
  -> 消息通知项目经理和任务负责人
  -> 工作台和看板查看进度统计
```

## 核心模块

- 客户与项目：客户档案、项目生命周期、项目负责人。
- 需求管理：需求录入、需求项拆分、确认、变更提醒。
- 任务管理：任务 CRUD、指派、状态更新、看板、任务成果目录。
- 成果归档：结果文件登记、飞书文件 Token 或文件 URL 保存。
- 工时与进度：工时记录、任务实际工时回写、逾期扫描。
- 消息通知：站内消息、飞书应用消息、飞书机器人消息。
- 飞书集成：配置检测、通讯录同步、应用消息、机器人消息、事件回调、同步日志。
- 报价适配：需求项与报价项映射、待确认差异、报价单管理。
- 风险与报表：风险提醒、周报、工作台统计。

## 快速启动

```bash
cd backend
npm install
copy .env.example .env
npm run start:dev
```

默认服务端口为 `3000`，健康检查：

```text
GET http://localhost:3000/api/v1/health
```

## 数据库初始化

```bash
mysql -u <user> -p < mysql_schema.sql
```

或使用脚本：

```bash
python scripts/deploy_mysql_schema.py
python scripts/seed_mysql_base_data.py
python scripts/seed_app_demo_data.py
```

## 飞书配置

在 `backend/.env` 中配置：

```env
FEISHU_APP_ID=
FEISHU_APP_SECRET=
FEISHU_BOT_WEBHOOK_URL=
FEISHU_EVENT_VERIFICATION_TOKEN=
FEISHU_DEFAULT_DEPARTMENT_ID=0
```

飞书企业自建应用需要开通通讯录读取和消息发送相关权限。员工同步后，本地用户会通过 `feishu_open_id` 与飞书员工关联，用于任务通知和个人消息投递。

## 推荐阅读顺序

1. [PROJECT_STATUS.md](PROJECT_STATUS.md)
2. [MVP_SCOPE.md](MVP_SCOPE.md)
3. [NOTIFICATION_RULES.md](NOTIFICATION_RULES.md)
4. [API_SPEC.md](API_SPEC.md)
5. [DB_SCHEMA.md](DB_SCHEMA.md)
6. [backend/README.md](backend/README.md)
