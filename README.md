# 效能引擎

效能引擎是一套借助 AI 的项目管理软件规划与后端 MVP，目标是把客户需求收集、员工任务指派、管理者进度跟进、报价与财务结算串成一条可追踪的业务闭环。

项目的关键业务特点是：项目部按需求推进，财务侧按报价单结算，因此系统需要在“需求项”和“报价项”之间建立可审核、可追踪、可调整的适配关系。

## 当前范围

- 客户、项目、需求、任务、工时、风险、周报、报价单、需求报价映射等核心模型。
- 后端 MVP 使用 NestJS + TypeORM + MySQL。
- 已输出 PRD、数据库表结构、MySQL 建表 SQL、后端 API 清单、ER 图与模块关系图。
- 已提供 dashboard、projects、requirements、tasks、quotations、quote-mappings、worklogs、risk-alerts、weekly-reports 等模块的 CRUD 和业务动作接口雏形。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | 项目整体规划、业务目标、MVP 范围、实施路线 |
| [MVP_SCOPE.md](MVP_SCOPE.md) | 第一版最小 MVP 范围和验收闭环 |
| [PRD.md](PRD.md) | 产品需求文档，包含角色、场景、功能范围和业务流程 |
| [DB_SCHEMA.md](DB_SCHEMA.md) | 数据库表结构设计说明 |
| [mysql_schema.sql](mysql_schema.sql) | MySQL 建库建表 SQL |
| [API_SPEC.md](API_SPEC.md) | 后端 REST API 清单 |
| [DIAGRAMS.md](DIAGRAMS.md) | ER 图、模块关系图、核心流程图 |
| [pm_workflow_diagram.svg](pm_workflow_diagram.svg) | 项目流程图 SVG |
| [pm_dashboard_prototype.html](pm_dashboard_prototype.html) | 项目管理工作台原型 |
| [backend/README.md](backend/README.md) | 后端服务启动、配置和脚本说明 |

## 业务主线

## 最小 MVP

- 飞书通信机制：配置检测、机器人消息、应用消息、员工同步、事件回调、同步日志。
- 需求收集：第一版先支持手工录入和编辑，后续接入 AI 从飞书沟通群自动提取。
- 任务分配：需求项生成任务，任务分配给员工，并登记任务成果目录和权限状态。
- 成果归档：员工把结果文件放到任务目录，并在系统登记文件链接。
- 进度统计：任务看板、进度百分比、工时回写、工作台统计。

```text
客户需求收集
  -> 需求结构化与确认
  -> 任务拆解与员工指派
  -> 任务执行、工时记录、风险跟进
  -> 需求项与报价项适配
  -> 报价审核与财务结算
```

## 核心模块

- 工作台：项目概览、待办、风险、经营指标。
- 客户与项目：客户档案、项目生命周期、项目成员。
- 需求管理：需求录入、需求项拆解、状态流转、AI 结构化建议。
- 任务管理：任务 CRUD、指派、状态更新、负责人视图。
- 工时与进度：工时记录、任务实际投入、周报生成。
- 报价与结算：报价单、报价项、审核、确认、结算基础数据。
- 需求报价适配：需求项与报价项映射、AI 建议、人工确认、差异提示。
- 风险预警：延期、阻塞、超工时等风险识别。
- 飞书集成：文档、消息、任务、机器人通知等后续接入方向。

## 后端快速启动

```bash
cd backend
npm install
copy .env.example .env
npm run start:dev
```

默认服务端口为 `3000`，健康检查接口：

```text
GET http://localhost:3000/health
```

## 数据库初始化

先创建 MySQL 数据库与表：

```bash
mysql -u <user> -p < mysql_schema.sql
```

也可以使用脚本目录里的辅助工具：

```bash
python scripts/deploy_mysql_schema.py
python scripts/seed_mysql_base_data.py
python scripts/seed_app_demo_data.py
```

## 推荐阅读顺序

1. 先读 [PROJECT_PLAN.md](PROJECT_PLAN.md)，确认项目定位和阶段目标。
2. 再读 [PRD.md](PRD.md)，理解用户角色、功能范围和业务场景。
3. 接着看 [DIAGRAMS.md](DIAGRAMS.md)，快速建立业务对象关系。
4. 开发后端前看 [DB_SCHEMA.md](DB_SCHEMA.md)、[mysql_schema.sql](mysql_schema.sql) 和 [API_SPEC.md](API_SPEC.md)。
5. 启动服务时参考 [backend/README.md](backend/README.md)。
