# 效能引擎后端

这是效能引擎项目的后端 MVP，基于 NestJS、TypeORM 和 MySQL 实现，用于承接项目管理、需求管理、任务管理、报价结算和需求报价适配等核心业务。

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
  projects/          项目管理
  quote-mappings/    需求报价适配
  quotations/        报价单管理
  requirements/      需求管理
  risk-alerts/       风险预警
  tasks/             任务管理
  users/             用户与角色
  weekly-reports/    周报
  worklogs/          工时
```

## 环境配置

复制环境变量模板：

```bash
copy .env.example .env
```

主要配置项：

```env
PORT=3000
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your-password
DB_NAME=efficiency_engine
```

## 启动

```bash
npm install
npm run start:dev
```

健康检查：

```text
GET http://localhost:3000/health
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

## API 文档

接口清单见根目录 [../API_SPEC.md](../API_SPEC.md)。

当前模块已覆盖：

- `GET /health`
- `GET /dashboard/overview`
- `GET /dashboard/alerts`
- `/customers`
- `/projects`
- `/requirements`
- `/tasks`
- `/worklogs`
- `/quotations`
- `/quote-mappings`
- `/risk-alerts`
- `/weekly-reports`
- `/users`

## 数据库

建表 SQL 见根目录 [../mysql_schema.sql](../mysql_schema.sql)。

数据模型设计说明见根目录 [../DB_SCHEMA.md](../DB_SCHEMA.md)。
