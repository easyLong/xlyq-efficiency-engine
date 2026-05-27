# 消息通知规则

本文档定义效能引擎 MVP 阶段的消息通知规则。第一版采用“站内消息落库 + 飞书应用消息优先 + 必要时飞书机器人群通知”的机制。

## 渠道约定

- `in_app`：站内消息，所有业务通知都必须落库。
- `feishu_app`：飞书企业自建应用消息，适合通知具体员工。
- `feishu_bot`：飞书机器人群消息，适合重要节点或群内广播。

## P0 自动通知

| 场景 | 触发方式 | 接收人 | 渠道 |
| --- | --- | --- | --- |
| 任务分配 | 调用 `POST /tasks/{id}/assign` | 任务负责人 | `in_app`、`feishu_app` |
| 任务状态变更 | 调用 `POST /tasks/{id}/status` | 任务负责人、项目经理 | `in_app`、`feishu_app` |
| 任务阻塞 | 状态变更为 `blocked` | 任务负责人、项目经理 | `in_app`、`feishu_app` |
| 任务待验收 | 状态变更为 `pending_review` | 任务负责人、项目经理 | `in_app`、`feishu_app` |
| 任务完成 | 状态变更为 `completed` | 任务负责人、项目经理 | `in_app`、`feishu_app` |
| 成果文件提交 | 调用 `POST /tasks/{id}/result-files` | 任务负责人、项目经理 | `in_app`、`feishu_app` |
| 新需求创建 | 调用 `POST /requirements` | 项目经理 | `in_app`、`feishu_app` |
| 需求变更 | 调用 `PATCH /requirements/{id}` 或需求解析确认 | 项目经理 | `in_app`、`feishu_app` |
| 需求项确认 | 调用 `POST /requirement-items/{id}/confirm` | 项目经理 | `in_app`、`feishu_app` |

## P0 扫描通知

这些通知先提供手动触发接口，后续可以接入定时任务。

| 场景 | 接口 | 接收人 | 说明 |
| --- | --- | --- | --- |
| 任务即将逾期 / 已逾期 | `POST /notifications/task-deadline-scan` | 任务负责人、项目经理 | 默认扫描未来 1 天内截止和已经逾期的未完成任务 |
| 工时未提交 | `POST /notifications/worklog-reminders` | 任务负责人 | 默认扫描当天未填写工时的进行中任务 |
| 飞书同步失败 | `POST /notifications/feishu-sync-failure-scan` | 本地管理员 | 默认扫描最近 24 小时失败的飞书同步日志 |

## 防打扰原则

- 个人动作优先发个人消息，不默认刷群。
- 群机器人只用于项目级重要事件或人工显式选择 `feishu_bot`。
- 所有飞书投递失败都不会阻断主业务流程，只记录在 `notification_messages.delivery_result_json` 和 `error_message` 中。
- 定时扫描类通知后续需要增加去重策略，避免同一任务在短时间内重复提醒。
