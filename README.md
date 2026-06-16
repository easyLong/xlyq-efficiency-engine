# 向量引擎管理工作台

更新时间：2026-06-16

向量引擎管理工作台是一套面向基金客户服务团队的项目效能系统，用来把“需求录入、任务指派、资产登记、合同报价录入、报价子项选择、结算统计、需求面板”串成一条可追踪的数据链路。

当前仓库已落地可运行 MVP：后端为 NestJS + TypeORM + MySQL，前端暂时是后端托管的静态页面。

## 当前能力

- 管理端页面：`http://localhost:3000/`
- 后端 API：`http://localhost:3000/api/v1`
- 健康检查：`GET /api/v1/health`
- 员工本地交付登记页：`GET /asset-sheet.html?taskId=<taskId>&taskNo=<taskNo>&token=<token>`
- 当前默认数据库：`ops_platform`
- 登录与接口：当前为 MVP 用户选择登录，受保护接口使用 `Authorization: Bearer <accessToken>`

核心闭环：

```text
对接人/基金/平台/业务分类
  -> 录入需求并自动生成任务
  -> 指派员工并发送飞书消息
  -> 员工登记图片资产和单个交付链接
  -> 导入合同报价并生成报价子项
  -> 历史需求任务中选择报价子项
  -> 按资产个数 × 已确认报价单价生成结算统计
  -> 需求面板按基金、平台、分类、员工过滤
```

## 关键业务维度

需求与后续筛选统一使用这些维度：

- 基金客户
- 对接人
- 业务平台：招行、工行、交行、理财通、蚂蚁、天天基金
- 业务大类：设计、文案、运营、社区
- 二级分类
- 员工

对接人配置当前只明确维护基金客户和业务平台；业务大类与二级分类由独立关系表维护，大类选定后二级分类下拉联动。三级分类已不再作为全局筛选维度，但历史字段仍保留用于兼容旧数据。

合同报价录入本身只选择基金客户和报价文件；报价合同内可以覆盖多个业务大类。CSV 合同优先按表格结构解析，识别最细粒度子项、单位、单价，并把最后层级和备注放入子项详情。

## 快速启动

```bash
cd backend
npm install
copy .env.example .env
npm run start:dev
```

生产方式启动当前构建：

```bash
cd backend
npm run build
npm run start:prod
```

常用验证：

```bash
cd backend
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

## 数据库

建表脚本：

```bash
mysql -u <user> -p ops_platform < mysql_schema.sql
```

初始化/种子脚本读取环境变量：

```bash
python scripts/deploy_mysql_schema.py
python scripts/seed_mysql_base_data.py
python scripts/seed_app_demo_data.py
```

跨库迁移项目相关表：

```bash
cd backend
npm run migrate:project-tables -- --help
npm run migrate:project-tables -- --execute
```

迁移脚本默认读取 `backend/.env` 的源库配置，目标库通过 `TARGET_DB_NAME` 指定。

## 文档导航

| 文档 | 用途 |
| --- | --- |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | 当前实现状态、验证结果、已知限制 |
| [DATA_FLOW.md](DATA_FLOW.md) | 需求、任务、报价、结算的数据链路和一致性规则 |
| [AI_INTAKE_PREVIEW.md](AI_INTAKE_PREVIEW.md) | AI 候选需求预览、证据链、人工确认入库流程 |
| [MVP_SCOPE.md](MVP_SCOPE.md) | MVP 范围和验收闭环 |
| [API_SPEC.md](API_SPEC.md) | 当前主要 API 清单和联调说明 |
| [DB_SCHEMA.md](DB_SCHEMA.md) | 数据库表结构设计说明 |
| [mysql_schema.sql](mysql_schema.sql) | MySQL 建表 SQL |
| [DIAGRAMS.md](DIAGRAMS.md) | ER 图、模块关系图、核心流程图 |
| [backend/README.md](backend/README.md) | 后端启动、环境变量、脚本和模块说明 |
| [NOTIFICATION_RULES.md](NOTIFICATION_RULES.md) | 消息通知规则 |
| [FEISHU_INTEGRATION_RUNBOOK.md](FEISHU_INTEGRATION_RUNBOOK.md) | 飞书集成配置和排障 |
| [PROJECT_PLAN.md](PROJECT_PLAN.md) | 产品规划文档 |
| [PRD.md](PRD.md) | 产品需求文档 |

## 当前已知限制

- 登录仍是 MVP 用户选择登录，没有账号密码校验、RBAC 和项目级数据权限；管理端接口已接入 MVP Token 鉴权。
- 管理端前端仍是单个静态 HTML，后续应工程化为 Vue/React 项目。
- 飞书在线表格依赖企业应用权限；权限不足时自动降级到本地交付登记页。
- 结算单目前是实时预览，还没有正式结算单持久化、审批和导出流程。
- 定时扫描类通知当前保留手动触发接口，尚未接入调度器。

## 2026-06-16 AI 候选需求预览更新

- 新增 `AI预览需求` 面板，位于需求录入页右侧、历史需求任务状态上方。
- 面板直接读取 `crawler_app.demand_intake_candidates` 中未确认候选需求，并聚合 `demand_candidate_evidence` 证据链。
- 每条候选需求以完整横向卡片展示，左侧显示需求摘要，右侧显示群聊证据。
- 点击候选卡片会自动填充左侧手动录入表单，管理员可修改后点击 `确认需求`。
- 确认后复用正式需求录入链路创建需求、需求项和待指派任务，并将候选需求状态回写为 `confirmed`。
- 后端启动支持 `HOST` 环境变量，局域网访问时可设置 `HOST=0.0.0.0`。

## 2026-06-15 数据架构与页面口径更新

- 品牌与模块命名调整为：向量引擎管理工作台、合同报价录入、结算统计、需求面板。
- 对接人配置收敛为“对接人 -> 基金客户 + 业务平台”，不再在该表维护业务大类、二级分类、三级分类。
- 新增 `business_category_secondary_categories`，固化业务大类与二级分类关系，前端按大类联动二级分类下拉。
- 历史需求任务状态优化了指派、改派、报价选择、报价确认后的即时刷新。
- 报价映射改为幂等保存：同一需求项重新选择报价时，旧有效映射标记为 `obsolete`，状态计算只看有效映射。
- 历史需求看板修复二次 `take 500` 导致子项、任务、报价映射被截断的问题。
- 需求、任务、资产、报价、报价映射、对接人配置等高频表补充启动期安全索引。

## 2026-06-11 架构与流程更新

本轮重点完成第二阶段“解耦”和整体流程收口：

- 任务状态机集中到 `backend/src/tasks/task-status.ts`，并新增 `task_status_histories` 记录状态流转审计。
- 任务流程快照集中到 `backend/src/tasks/task-workflow.ts`，接口会返回当前阶段、下一步动作、可用操作和进度。
- 飞书集成已拆分为 OpenAPI client、表格 client、卡片模板、回调解析、任务卡片动作处理、员工同步 service。
- AI 提示词已迁移到 `backend/src/ai-prompts/prompt-registry.ts`，按 key 和 version 管理。
- 维度字典新增 `dimension_dictionaries` 表和 `/api/v1/dimensions` 接口，业务平台/大类/二级分类由后端统一种子和维护。
- 前端静态页已开始模块化，新增 `public/js/app-shell.js`、`public/js/api-client.js`、`public/js/domain-config.js`。
- 员工资产登记页会展示任务“下一步”，提交图片资产或交付链接后任务进入 `pending_review`，统计口径同步使用资产文件表。

最新验证命令：

```bash
cd backend
npm test -- --runInBand
npm run build
```
