# 效能引擎数据库表结构设计

## 1. 文档目标

本文档用于定义效能引擎 V1 的数据库表结构设计，服务于以下目标：

- 支撑 `需求 -> 任务 -> 工时 -> 报价适配 -> 报价单 -> 结算` 主链路
- 支撑飞书集成、AI 建议、审计日志等辅助能力
- 为后续接口设计、ORM 建模、SQL 建表脚本提供依据

## 2. 技术假设

- 数据库：MySQL 8.0+
- 主键类型：`char(36)`，应用层按 UUID 字符串处理
- 时间字段：`datetime`
- 金额字段：`numeric(14,2)`
- 工时字段：`numeric(8,2)`
- 状态类字段：V1 采用 `varchar(32)`，由应用层和数据库约束共同控制
- 软删除：关键业务表保留 `deleted_at`

## 3. 设计原则

- 所有核心对象都必须可审计、可追溯
- 需求口径与报价口径分层建模，不直接混用
- 用中间表表达 `需求项 <-> 报价项` 的多对多关系
- 变更必须显式建模，不能只覆盖原数据
- 飞书同步和 AI 执行都必须保留独立日志

## 4. 命名规范

- 表名：复数蛇形命名，如 `projects`
- 主键：统一为 `id`
- 外键：统一为 `<entity>_id`
- 状态字段：统一为 `status`
- 排序字段：统一为 `sort_order`
- 备注字段：统一为 `remark`
- 通用时间字段：
  - `created_at`
  - `updated_at`
  - `deleted_at`

## 5. 通用字段约定

建议以下业务表默认包含：

```text
id char(36) pk
created_at datetime not null
updated_at datetime not null
deleted_at datetime null
created_by char(36) null
updated_by char(36) null
```

说明：

- `created_by`、`updated_by` 关联 `users.id`
- 日志表可不使用 `deleted_at`
- 纯关联表可只保留必要字段

## 6. 核心关系概览

```text
customers 1---n projects
projects 1---n requirements
requirements 1---n requirement_versions
requirements 1---n requirement_items
requirement_items 1---n tasks
tasks 1---1 task_directories
tasks 1---n task_result_files
tasks 1---n worklogs
projects 1---n quotations
quotations 1---n quotation_items
requirement_items n---n quotation_items (via requirement_quotation_mappings)
projects 1---n change_requests
change_requests 1---n change_request_items
projects 1---n risk_alerts
projects 1---n weekly_reports
projects 1---n feishu_object_links
users 1---n notification_messages
projects 1---n ai_execution_logs
users n---n roles (via user_roles)
projects n---n users (via project_members)
```

## 7. 用户与权限域

## 7.1 `users`

用户主表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 用户ID |
| username | varchar(64) | unique, not null | 登录名 |
| display_name | varchar(64) | not null | 展示名 |
| email | varchar(128) | null | 邮箱 |
| mobile | varchar(32) | null | 手机号 |
| avatar_url | varchar(512) | null | 头像 |
| status | varchar(32) | not null | `active/inactive/locked` |
| source | varchar(32) | not null | `local/feishu` |
| feishu_open_id | varchar(128) | unique null | 飞书用户标识 |
| last_login_at | timestamptz | null | 最后登录时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `uk_users_username`
- `uk_users_feishu_open_id`
- `idx_users_status`

## 7.2 `roles`

角色表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 角色ID |
| role_code | varchar(32) | unique, not null | `admin/pm/member/manager/finance/customer` |
| role_name | varchar(64) | not null | 角色名称 |
| remark | varchar(255) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

## 7.3 `user_roles`

用户角色关联表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| user_id | uuid | fk, not null | 用户ID |
| role_id | uuid | fk, not null | 角色ID |
| created_at | timestamptz | not null | 创建时间 |

唯一约束：

- `(user_id, role_id)`

## 8. 客户与项目域

## 8.1 `customers`

客户主档。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 客户ID |
| customer_code | varchar(32) | unique, null | 客户编码 |
| customer_name | varchar(128) | not null | 客户名称 |
| contact_name | varchar(64) | null | 联系人 |
| contact_mobile | varchar(32) | null | 联系电话 |
| contact_email | varchar(128) | null | 邮箱 |
| industry | varchar(64) | null | 行业 |
| source | varchar(32) | null | 来源 |
| status | varchar(32) | not null | `active/inactive` |
| remark | varchar(255) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

## 8.2 `projects`

项目主表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 项目ID |
| project_code | varchar(32) | unique, not null | 项目编码 |
| project_name | varchar(128) | not null | 项目名称 |
| customer_id | uuid | fk, not null | 客户ID |
| owner_user_id | uuid | fk, not null | 项目经理 |
| project_type | varchar(32) | null | 项目类型 |
| status | varchar(32) | not null | `pending/in_progress/paused/completed/settled` |
| priority | varchar(32) | null | 优先级 |
| budget_amount | numeric(14,2) | null | 预算金额 |
| start_date | date | null | 开始日期 |
| planned_end_date | date | null | 计划结束日期 |
| actual_end_date | date | null | 实际结束日期 |
| description | text | null | 说明 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `uk_projects_project_code`
- `idx_projects_customer_id`
- `idx_projects_owner_user_id`
- `idx_projects_status`
- `idx_projects_planned_end_date`

## 8.3 `project_members`

项目成员表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| project_id | uuid | fk, not null | 项目ID |
| user_id | uuid | fk, not null | 用户ID |
| member_role | varchar(32) | not null | `pm/member/reviewer/finance/observer` |
| joined_at | timestamptz | not null | 加入时间 |
| left_at | timestamptz | null | 离开时间 |
| created_at | timestamptz | not null | 创建时间 |

唯一约束：

- `(project_id, user_id, member_role)`

## 8.4 `project_milestones`

项目里程碑。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 里程碑ID |
| project_id | uuid | fk, not null | 项目ID |
| milestone_name | varchar(128) | not null | 里程碑名称 |
| status | varchar(32) | not null | `pending/in_progress/completed/cancelled` |
| planned_date | date | null | 计划日期 |
| actual_date | date | null | 实际日期 |
| sort_order | int | null | 排序 |
| remark | varchar(255) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

## 9. 需求域

## 9.1 `requirements`

需求主表，记录一次需求提交的主对象。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 需求ID |
| requirement_code | varchar(32) | unique, not null | 需求编码 |
| project_id | uuid | fk, not null | 所属项目 |
| customer_id | uuid | fk, not null | 所属客户 |
| title | varchar(256) | not null | 需求标题 |
| source_type | varchar(32) | not null | `manual/feishu_doc/feishu_message/import` |
| source_ref_id | varchar(128) | null | 外部来源ID |
| status | varchar(32) | not null | `draft/pending_parse/pending_confirm/confirmed/in_progress/completed/cancelled` |
| priority | varchar(32) | null | `low/medium/high/urgent` |
| raw_content | text | null | 原始内容 |
| summary | text | null | 摘要 |
| submitted_by_user_id | uuid | fk, null | 提交人 |
| confirmed_by_user_id | uuid | fk, null | 确认人 |
| confirmed_at | timestamptz | null | 确认时间 |
| current_version_no | int | not null default 1 | 当前版本 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `uk_requirements_requirement_code`
- `idx_requirements_project_id`
- `idx_requirements_customer_id`
- `idx_requirements_status`
- `idx_requirements_source_type_source_ref_id`

## 9.2 `requirement_versions`

需求版本表，保留需求正文与结构化结果快照。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 版本ID |
| requirement_id | uuid | fk, not null | 需求ID |
| version_no | int | not null | 版本号 |
| raw_content | text | not null | 原始内容 |
| structured_result_json | jsonb | null | AI 结构化输出 |
| changed_reason | varchar(255) | null | 变更原因 |
| created_by | uuid | fk, null | 操作人 |
| created_at | timestamptz | not null | 创建时间 |

唯一约束：

- `(requirement_id, version_no)`

## 9.3 `requirement_items`

需求项表，是项目侧最小管理颗粒度。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 需求项ID |
| requirement_id | uuid | fk, not null | 需求ID |
| parent_item_id | uuid | fk, null | 父需求项 |
| item_no | varchar(64) | not null | 项目内编号 |
| item_title | varchar(256) | not null | 需求项标题 |
| item_description | text | null | 描述 |
| business_goal | text | null | 业务目标 |
| acceptance_criteria | text | null | 验收标准 |
| priority | varchar(32) | null | 优先级 |
| estimated_days | numeric(8,2) | null | 预计工期 |
| estimated_hours | numeric(8,2) | null | 预计工时 |
| status | varchar(32) | not null | `pending_confirm/confirmed/in_progress/completed/cancelled/obsolete` |
| quote_scope_status | varchar(32) | not null | `not_started/in_scope/out_of_scope/changed` |
| owner_user_id | uuid | fk, null | 需求责任人 |
| sort_order | int | null | 排序 |
| version_no | int | not null default 1 | 来源版本号 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

唯一约束：

- `(requirement_id, item_no)`

索引建议：

- `idx_requirement_items_requirement_id`
- `idx_requirement_items_status`
- `idx_requirement_items_quote_scope_status`
- `idx_requirement_items_owner_user_id`

## 10. 任务与工时域

## 10.1 `tasks`

任务表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 任务ID |
| project_id | uuid | fk, not null | 项目ID |
| requirement_item_id | uuid | fk, null | 关联需求项 |
| parent_task_id | uuid | fk, null | 父任务 |
| task_no | varchar(32) | not null | 任务编号 |
| task_name | varchar(256) | not null | 任务名称 |
| description | text | null | 描述 |
| status | varchar(32) | not null | `todo/in_progress/blocked/pending_review/completed/closed` |
| priority | varchar(32) | null | 优先级 |
| assignee_user_id | uuid | fk, null | 负责人 |
| reporter_user_id | uuid | fk, null | 创建人 |
| planned_start_at | timestamptz | null | 计划开始 |
| planned_end_at | timestamptz | null | 计划结束 |
| actual_start_at | timestamptz | null | 实际开始 |
| actual_end_at | timestamptz | null | 实际结束 |
| estimated_hours | numeric(8,2) | null | 预计工时 |
| actual_hours | numeric(8,2) | not null default 0 | 实际工时汇总 |
| progress_percent | int | not null default 0 | 进度百分比 |
| blocked_reason | varchar(255) | null | 阻塞原因 |
| sort_order | int | null | 排序 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

唯一约束：

- `(project_id, task_no)`

索引建议：

- `idx_tasks_project_id`
- `idx_tasks_requirement_item_id`
- `idx_tasks_assignee_user_id`
- `idx_tasks_status`
- `idx_tasks_planned_end_at`

## 10.2 `task_directories`

任务成果目录和权限状态表，服务于“任务分配给人后，给人进入对应目录的权限”。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | char(36) | pk | 主键 |
| task_id | char(36) | fk, not null | 任务ID |
| project_id | char(36) | fk, not null | 项目ID |
| assignee_user_id | char(36) | fk, null | 被授权人 |
| feishu_folder_token | varchar(128) | null | 飞书目录 Token |
| directory_url | varchar(500) | null | 目录访问链接 |
| permission_status | varchar(32) | not null | `pending_sync/mock_granted/granted/failed` |
| last_synced_at | datetime | null | 最近同步时间 |
| created_at | datetime | not null | 创建时间 |
| updated_at | datetime | not null | 更新时间 |
| deleted_at | datetime | null | 删除时间 |

唯一约束：
- `task_id`

索引建议：
- `idx_task_directories_project_id`
- `idx_task_directories_assignee_user_id`

## 10.3 `task_result_files`

任务结果文件表，记录员工放入任务目录的成果文件。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | char(36) | pk | 主键 |
| task_id | char(36) | fk, not null | 任务ID |
| project_id | char(36) | fk, not null | 项目ID |
| file_name | varchar(256) | not null | 文件名 |
| file_url | varchar(500) | not null | 文件链接 |
| feishu_file_token | varchar(128) | null | 飞书文件 Token |
| uploaded_by_user_id | char(36) | fk, null | 上传人 |
| source | varchar(32) | not null | `manual/feishu` |
| remark | varchar(500) | null | 备注 |
| created_at | datetime | not null | 创建时间 |
| updated_at | datetime | not null | 更新时间 |
| deleted_at | datetime | null | 删除时间 |

索引建议：
- `idx_task_result_files_task_id`
- `idx_task_result_files_project_id`
- `idx_task_result_files_uploaded_by_user_id`

## 10.4 `task_watchers`

任务关注人。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| task_id | uuid | fk, not null | 任务ID |
| user_id | uuid | fk, not null | 用户ID |
| created_at | timestamptz | not null | 创建时间 |

唯一约束：

- `(task_id, user_id)`

## 10.5 `worklogs`

工时记录表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 工时ID |
| project_id | uuid | fk, not null | 项目ID |
| task_id | uuid | fk, not null | 任务ID |
| requirement_item_id | uuid | fk, null | 冗余关联需求项 |
| user_id | uuid | fk, not null | 记录人 |
| work_date | date | not null | 工时日期 |
| hours | numeric(8,2) | not null | 工时 |
| work_summary | varchar(500) | null | 工作说明 |
| source | varchar(32) | not null | `manual/feishu/import/system` |
| approval_status | varchar(32) | not null | `draft/submitted/approved/rejected` |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `idx_worklogs_project_id`
- `idx_worklogs_task_id`
- `idx_worklogs_requirement_item_id`
- `idx_worklogs_user_id_work_date`

## 10.6 `resource_load_snapshots`

资源负载快照表，用于日报表与 AI 负载分析。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| user_id | uuid | fk, not null | 用户ID |
| snapshot_date | date | not null | 快照日期 |
| assigned_task_count | int | not null default 0 | 分配任务数 |
| in_progress_task_count | int | not null default 0 | 进行中任务数 |
| total_planned_hours | numeric(8,2) | not null default 0 | 计划工时 |
| total_actual_hours | numeric(8,2) | not null default 0 | 实际工时 |
| load_score | numeric(5,2) | not null default 0 | 负载评分 |
| created_at | timestamptz | not null | 创建时间 |

唯一约束：

- `(user_id, snapshot_date)`

## 11. 风险与周报域

## 11.1 `risk_alerts`

风险预警表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 风险ID |
| project_id | uuid | fk, not null | 项目ID |
| task_id | uuid | fk, null | 关联任务 |
| requirement_item_id | uuid | fk, null | 关联需求项 |
| alert_type | varchar(32) | not null | `overdue/high_load/blocked/scope_mismatch` |
| severity | varchar(32) | not null | `low/medium/high/critical` |
| title | varchar(256) | not null | 标题 |
| content | text | null | 内容 |
| status | varchar(32) | not null | `open/acknowledged/resolved/ignored` |
| triggered_at | timestamptz | not null | 触发时间 |
| resolved_at | timestamptz | null | 解决时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

索引建议：

- `idx_risk_alerts_project_id_status`
- `idx_risk_alerts_task_id`
- `idx_risk_alerts_alert_type`

## 11.2 `weekly_reports`

周报表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 周报ID |
| project_id | uuid | fk, not null | 项目ID |
| report_week | varchar(16) | not null | 如 `2026-W21` |
| title | varchar(256) | not null | 标题 |
| content | text | null | 周报正文 |
| source | varchar(32) | not null | `ai/manual/mixed` |
| status | varchar(32) | not null | `draft/confirmed/sent/archived` |
| generated_by_ai_log_id | uuid | fk, null | 对应 AI 日志 |
| sent_to_feishu_at | timestamptz | null | 飞书发送时间 |
| created_by | uuid | fk, null | 创建人 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

唯一约束：

- `(project_id, report_week)`

## 12. 报价与结算域

## 12.1 `quote_templates`

报价模板主表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 模板ID |
| template_code | varchar(32) | unique, not null | 模板编码 |
| template_name | varchar(128) | not null | 模板名称 |
| project_type | varchar(32) | null | 适用项目类型 |
| industry | varchar(64) | null | 适用行业 |
| status | varchar(32) | not null | `active/inactive` |
| remark | varchar(255) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

## 12.2 `quote_template_items`

报价模板项表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 模板项ID |
| template_id | uuid | fk, not null | 模板ID |
| item_code | varchar(64) | not null | 模板项编码 |
| item_name | varchar(128) | not null | 模板项名称 |
| pricing_mode | varchar(32) | not null | `fixed/by_hour/by_day/by_phase` |
| default_unit | varchar(32) | null | 单位 |
| default_unit_price | numeric(14,2) | null | 默认单价 |
| sort_order | int | null | 排序 |
| remark | varchar(255) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

唯一约束：

- `(template_id, item_code)`

## 12.3 `quotations`

报价单主表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 报价单ID |
| quotation_no | varchar(32) | unique, not null | 报价单编号 |
| project_id | uuid | fk, not null | 项目ID |
| customer_id | uuid | fk, not null | 客户ID |
| status | varchar(32) | not null | `draft/pending_review/pending_customer_confirm/confirmed/rejected/settled` |
| pricing_basis | varchar(32) | not null | `mapping/manual/mixed` |
| total_amount | numeric(14,2) | not null default 0 | 总金额 |
| currency_code | varchar(16) | not null default 'CNY' | 币种 |
| version_no | int | not null default 1 | 版本号 |
| confirmed_at | timestamptz | null | 确认时间 |
| settled_at | timestamptz | null | 结算时间 |
| created_by | uuid | fk, null | 创建人 |
| reviewed_by | uuid | fk, null | 审核人 |
| remark | varchar(500) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `uk_quotations_quotation_no`
- `idx_quotations_project_id`
- `idx_quotations_customer_id`
- `idx_quotations_status`

## 12.4 `quotation_items`

报价项表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 报价项ID |
| quotation_id | uuid | fk, not null | 报价单ID |
| template_item_id | uuid | fk, null | 来源模板项 |
| item_code | varchar(64) | not null | 报价项编码 |
| item_name | varchar(128) | not null | 报价项名称 |
| pricing_mode | varchar(32) | not null | `fixed/by_hour/by_day/by_phase` |
| quantity | numeric(12,2) | not null default 1 | 数量 |
| unit | varchar(32) | null | 单位 |
| unit_price | numeric(14,2) | not null default 0 | 单价 |
| line_amount | numeric(14,2) | not null default 0 | 行金额 |
| source | varchar(32) | not null | `mapping/manual/template` |
| match_status | varchar(32) | not null | `matched/partial/manual_added/changed/obsolete` |
| sort_order | int | null | 排序 |
| remark | varchar(500) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

唯一约束：

- `(quotation_id, item_code)`

索引建议：

- `idx_quotation_items_quotation_id`
- `idx_quotation_items_template_item_id`
- `idx_quotation_items_match_status`

## 12.5 `requirement_quotation_mappings`

需求项与报价项映射表，是整个系统的关键中间层。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 映射ID |
| project_id | uuid | fk, not null | 项目ID |
| requirement_item_id | uuid | fk, not null | 需求项ID |
| quotation_id | uuid | fk, null | 报价单ID |
| quotation_item_id | uuid | fk, null | 报价项ID |
| mapping_status | varchar(32) | not null | `matched/partial/pending_confirm/out_of_scope/obsolete/rejected` |
| mapping_type | varchar(32) | not null | `one_to_one/one_to_many/many_to_one/manual` |
| matched_ratio | numeric(5,2) | null | 匹配度 |
| suggested_by_ai_log_id | uuid | fk, null | AI 关联日志 |
| confirmed_by | uuid | fk, null | 财务确认人 |
| confirmed_at | timestamptz | null | 确认时间 |
| change_request_id | uuid | fk, null | 变更单ID |
| remark | varchar(500) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

索引建议：

- `idx_rqm_project_id`
- `idx_rqm_requirement_item_id`
- `idx_rqm_quotation_item_id`
- `idx_rqm_mapping_status`
- `idx_rqm_change_request_id`

说明：

- 允许 `quotation_item_id` 在适配建议阶段为空
- 一个需求项可对应多条映射记录
- 一个报价项也可对应多条映射记录

## 12.6 `quotation_versions`

报价单版本快照表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 版本ID |
| quotation_id | uuid | fk, not null | 报价单ID |
| version_no | int | not null | 版本号 |
| snapshot_json | jsonb | not null | 报价快照 |
| changed_reason | varchar(255) | null | 变更原因 |
| created_by | uuid | fk, null | 操作人 |
| created_at | timestamptz | not null | 创建时间 |

唯一约束：

- `(quotation_id, version_no)`

## 12.7 `settlements`

结算表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 结算ID |
| quotation_id | uuid | fk, not null | 报价单ID |
| settlement_no | varchar(32) | unique, not null | 结算编号 |
| status | varchar(32) | not null | `pending/processing/completed/cancelled` |
| settled_amount | numeric(14,2) | not null default 0 | 结算金额 |
| settled_at | timestamptz | null | 结算时间 |
| remark | varchar(500) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

## 13. 变更管理域

## 13.1 `change_requests`

变更单主表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 变更单ID |
| change_no | varchar(32) | unique, not null | 变更单编号 |
| project_id | uuid | fk, not null | 项目ID |
| requirement_id | uuid | fk, null | 关联需求 |
| status | varchar(32) | not null | `draft/pending_assess/pending_confirm/effective/cancelled` |
| change_type | varchar(32) | not null | `add/remove/modify/replace` |
| title | varchar(256) | not null | 标题 |
| description | text | null | 描述 |
| impact_summary | text | null | 影响摘要 |
| estimated_delta_amount | numeric(14,2) | null | 预估金额变化 |
| submitted_by | uuid | fk, null | 提交人 |
| confirmed_by | uuid | fk, null | 确认人 |
| effective_at | timestamptz | null | 生效时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `uk_change_requests_change_no`
- `idx_change_requests_project_id`
- `idx_change_requests_status`

## 13.2 `change_request_items`

变更影响明细表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 明细ID |
| change_request_id | uuid | fk, not null | 变更单ID |
| requirement_item_id | uuid | fk, null | 受影响需求项 |
| task_id | uuid | fk, null | 受影响任务 |
| quotation_item_id | uuid | fk, null | 受影响报价项 |
| action_type | varchar(32) | not null | `add/remove/modify/relink` |
| before_snapshot_json | jsonb | null | 变更前快照 |
| after_snapshot_json | jsonb | null | 变更后快照 |
| delta_amount | numeric(14,2) | null | 金额变化 |
| remark | varchar(255) | null | 备注 |
| created_at | timestamptz | not null | 创建时间 |

索引建议：

- `idx_change_request_items_change_request_id`
- `idx_change_request_items_requirement_item_id`
- `idx_change_request_items_quotation_item_id`

## 14. 飞书集成域

## 14.1 `feishu_object_links`

系统对象与飞书对象映射表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| project_id | uuid | fk, null | 项目ID |
| object_type | varchar(32) | not null | `requirement/task/report/quotation` |
| object_id | uuid | not null | 系统对象ID |
| feishu_object_type | varchar(32) | not null | `doc/message/task/bot/calendar/approval` |
| feishu_object_id | varchar(128) | not null | 飞书对象ID |
| sync_direction | varchar(32) | not null | `inbound/outbound/bidirectional` |
| last_synced_at | timestamptz | null | 最后同步时间 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |

索引建议：

- `idx_feishu_object_links_object_type_object_id`
- `idx_feishu_object_links_feishu_object_type_feishu_object_id`

## 14.2 `feishu_sync_logs`

飞书同步日志表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 日志ID |
| object_type | varchar(32) | not null | 业务对象类型 |
| object_id | uuid | null | 业务对象ID |
| action_type | varchar(32) | not null | `pull/push/webhook/retry` |
| feishu_object_type | varchar(32) | not null | 飞书对象类型 |
| feishu_object_id | varchar(128) | null | 飞书对象ID |
| request_payload_json | jsonb | null | 请求报文 |
| response_payload_json | jsonb | null | 响应报文 |
| status | varchar(32) | not null | `success/failed/partial` |
| error_code | varchar(64) | null | 错误码 |
| error_message | text | null | 错误信息 |
| triggered_at | timestamptz | not null | 触发时间 |
| finished_at | timestamptz | null | 完成时间 |

索引建议：

- `idx_feishu_sync_logs_object_type_object_id`
- `idx_feishu_sync_logs_status`
- `idx_feishu_sync_logs_triggered_at`

## 15. AI 域

## 15.1 `ai_execution_logs`

AI 执行日志表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | AI日志ID |
| scene_code | varchar(32) | not null | `requirement_parse/task_assign/risk_detect/weekly_report/quote_mapping/quote_draft` |
| project_id | uuid | fk, null | 项目ID |
| object_type | varchar(32) | not null | 关联对象类型 |
| object_id | uuid | null | 关联对象ID |
| input_json | jsonb | null | 输入 |
| output_json | jsonb | null | 输出 |
| model_name | varchar(128) | null | 模型名 |
| status | varchar(32) | not null | `success/failed/cancelled` |
| execution_ms | int | null | 执行耗时 |
| error_message | text | null | 错误信息 |
| created_by | uuid | fk, null | 触发人 |
| created_at | timestamptz | not null | 创建时间 |

索引建议：

- `idx_ai_execution_logs_scene_code`
- `idx_ai_execution_logs_project_id`
- `idx_ai_execution_logs_object_type_object_id`

## 15.2 `ai_suggestion_actions`

AI 建议采纳记录表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 主键 |
| ai_log_id | uuid | fk, not null | AI日志ID |
| action_type | varchar(32) | not null | `accepted/rejected/edited_then_accepted` |
| target_object_type | varchar(32) | not null | 目标对象类型 |
| target_object_id | uuid | null | 目标对象ID |
| action_by | uuid | fk, null | 操作人 |
| action_at | timestamptz | not null | 操作时间 |
| remark | varchar(255) | null | 备注 |

索引建议：

- `idx_ai_suggestion_actions_ai_log_id`
- `idx_ai_suggestion_actions_target_object_type_target_object_id`

## 16. 审计与评论域

## 16.1 `audit_logs`

审计日志表。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 日志ID |
| object_type | varchar(32) | not null | 对象类型 |
| object_id | uuid | not null | 对象ID |
| action_type | varchar(32) | not null | `create/update/delete/status_change/confirm/send/export` |
| before_json | jsonb | null | 修改前 |
| after_json | jsonb | null | 修改后 |
| operator_user_id | uuid | fk, null | 操作人 |
| operator_name | varchar(64) | null | 冗余操作人名称 |
| created_at | timestamptz | not null | 创建时间 |

索引建议：

- `idx_audit_logs_object_type_object_id`
- `idx_audit_logs_operator_user_id`
- `idx_audit_logs_created_at`

## 16.2 `comments`

通用评论表，V1 可服务需求、任务、报价单讨论。

| 字段 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | uuid | pk | 评论ID |
| object_type | varchar(32) | not null | `requirement/task/quotation/change_request` |
| object_id | uuid | not null | 对象ID |
| content | text | not null | 评论内容 |
| author_user_id | uuid | fk, not null | 作者 |
| parent_comment_id | uuid | fk, null | 父评论 |
| created_at | timestamptz | not null | 创建时间 |
| updated_at | timestamptz | not null | 更新时间 |
| deleted_at | timestamptz | null | 删除时间 |

索引建议：

- `idx_comments_object_type_object_id`

## 17. V1 必做表清单

如果要尽快做 MVP，建议先落以下表：

- `users`
- `roles`
- `user_roles`
- `customers`
- `projects`
- `project_members`
- `requirements`
- `requirement_versions`
- `requirement_items`
- `tasks`
- `task_directories`
- `task_result_files`
- `worklogs`
- `risk_alerts`
- `weekly_reports`
- `quotations`
- `quotation_items`
- `requirement_quotation_mappings`
- `change_requests`
- `change_request_items`
- `feishu_object_links`
- `feishu_sync_logs`
- `notification_messages`
- `ai_execution_logs`
- `ai_suggestion_actions`
- `audit_logs`

## 18. 首版可延后表

这些可以在 V1.1 或 V2 再补：

- `project_milestones`
- `task_watchers`
- `resource_load_snapshots`
- `quote_templates`
- `quote_template_items`
- `quotation_versions`
- `settlements`
- `comments`

## 19. 关键约束建议

- 删除项目时禁止物理删除其下需求、任务、报价，统一走软删除
- 已确认报价单禁止直接修改报价项，必须先生成版本快照或变更单
- `requirement_quotation_mappings` 在报价确认后禁止无审计地覆盖更新
- 工时变更后应异步回写 `tasks.actual_hours`
- 需求项状态变更为 `obsolete` 时，应触发报价映射差异检查
- 飞书对象映射必须唯一，避免重复同步

## 20. 下一步建议

数据库表结构确认后，建议继续输出：

1. ER 图
2. MySQL 建表 SQL
3. ORM 实体定义
4. 核心接口清单
