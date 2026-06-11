# 数据链路说明

更新时间：2026-06-11

本文档说明当前 MVP 中“需求、任务、资产、报价、结算”的真实数据链路和一致性规则。

## 1. 主链路

```text
contact_context_configs
  -> requirements
  -> requirement_items
  -> tasks
  -> task_directories / task_result_files
  -> quotations
  -> quotation_items
  -> quotation_item_dimension_rules
  -> requirement_quotation_mappings
  -> 结算预览 / 统计分析
```

## 2. 需求录入链路

手动录入时优先选择对接人。

对接人配置表 `contact_context_configs` 可带出：

- 基金客户：`customer_id`
- 业务平台：`business_platform`
- 业务大类：`business_category`
- 二级分类：`secondary_category`
- 三级分类：`tertiary_category`

保存需求时写入：

- `requirements`
- `requirement_items`
- `tasks`

当前 MVP 约定：一条需求生成一个需求项和一个任务。

## 3. 业务维度

需求、筛选、统计统一使用这些维度：

| 维度 | 来源优先级 |
| --- | --- |
| 基金客户 | `requirements.customer_id` |
| 对接人 | `requirements.source_ref_id` 指向 `contact_context_configs.id` |
| 业务平台 | `requirements.business_platform`，兜底对接人配置 |
| 业务大类 | `requirements.business_category`，兜底对接人配置/项目类型 |
| 二级分类 | `requirements.secondary_category`，兜底对接人配置 |
| 三级分类 | `requirements.tertiary_category`，兜底对接人配置 |
| 员工 | `tasks.assignee_user_id` |

业务平台固定选项：

- 招行
- 工行
- 交行
- 理财通
- 蚂蚁
- 天天基金

业务大类和二级分类：

| 大类 | 二级分类 |
| --- | --- |
| 设计 | 配图拓展、banner新设计、巨幅新设计、长图新设计、长图拓展、长图套模板、其他 |
| 文案 | 数据更新、已有素材新编辑、原创文案、共建文案、其他 |
| 运营 | 发布陪伴、活动配置、魔秀搭建、页面推厂、直播配置、其他 |
| 社区 | 粉丝投放、精华贴、氛围贴、其他 |

三级分类可由对接人配置带出，也可以在需求录入时人工修改。

## 4. 任务和资产链路

任务指派后：

- `tasks.assignee_user_id` 记录负责人。
- 系统尝试创建飞书在线资产表。
- 飞书权限不足或本地兜底时，生成 `public/asset-sheet.html` 入口。
- 本地交付入口会携带任务访问 token：`asset-sheet.html?taskId=<taskId>&taskNo=<taskNo>&token=<token>`。
- 员工可上传、拖拽、粘贴图片，也可粘贴图片 URL；同时支持填写一个最终交付链接。
- 后台统一写入 `task_result_files`。

资产统计口径：

```text
COUNT(DISTINCT task_result_files.file_url)
WHERE source IN (
  'local_asset_sheet',
  'local_asset_sheet_image',
  'feishu_asset_sheet',
  'feishu_asset_sheet_image',
  'manual',
  'feishu'
)
```

说明：

- `local_asset_sheet_image` / `feishu_asset_sheet_image`：图片资产，计入结算资产个数。
- `local_asset_sheet_link` / `feishu_asset_sheet_link`：最终交付链接，只用于交付追踪，不计入结算资产个数。
- 本地交付登记保存使用事务，保存成功后任务进入 `pending_review`。

## 5. 报价单链路

报价单页面只选择：

- 基金客户
- 报价单文件/文本

报价合同可能覆盖多个业务大类，不要求导入时选择业务大类。

导入后写入：

- `quotations`
- `quotation_items`

报价子项字段重点：

- `item_name`：报价单层级关系拼接后的子项标题
- `remark`：子项描述
- `unit`：单位
- `unit_price`：单价
- `line_amount`：后端仍保留，用于总金额和历史兼容

页面明细当前突出显示单位和单价；数量和金额主要用于结算口径。

## 6. 报价子项维度规则

`quotation_item_dimension_rules` 用于给报价子项配置适用维度：

- 基金客户
- 业务平台
- 业务大类
- 二级分类
- 三级分类
- 优先级

规则用于后续自动建议，提高报价子项匹配准确性。

## 7. 需求任务选择报价子项

历史需求任务中点击报价选择时：

1. 按需求所属基金客户加载该基金报价单子项。
2. 人工选择报价子项。
3. 保存 `requirement_quotation_mappings`。
4. 回写：
   - `requirement_items.quote_scope_status`
   - `quotation_items.match_status`

后端校验：

- 需求项必须属于传入项目。
- 报价单客户必须等于需求客户。
- 报价子项必须属于所选报价单。
- 跨基金报价映射会被拒绝。

## 8. 状态口径

需求项报价状态 `quote_scope_status`：

| 状态 | 含义 |
| --- | --- |
| `not_started` | 未适配 |
| `pending_confirm` | 报价待确认 |
| `partial` | 待人工适配 |
| `changed` | 报价有变更 |
| `matched` | 报价已确认 |

报价子项挂靠状态 `match_status`：

| 状态 | 含义 |
| --- | --- |
| `unmatched` | 待挂靠 |
| `price_missing` | 待补价 |
| `manual_added` | 人工新增 |
| `matched` | 已挂靠 |
| `confirmed` | 已确认 |

失效映射：

- `rejected`
- `obsolete`

失效映射不再占用报价子项。

## 9. 删除一致性规则

删除需求：

- 软删除 `requirements`
- 软删除 `requirement_items`
- 软删除 `tasks`
- 软删除任务工作目录和资产记录
- 删除相关 `requirement_quotation_mappings`
- 回算报价子项 `match_status`
- 以上动作在事务中执行，避免只删一半导致数据链路断裂。

删除报价子项：

- 删除相关 `requirement_quotation_mappings`
- 软删除相关 `quotation_item_dimension_rules`
- 软删除 `quotation_items`
- 回算需求项 `quote_scope_status`
- 重算报价单总金额

删除报价单：

- 删除相关 `requirement_quotation_mappings`
- 软删除报价子项维度规则
- 软删除报价子项
- 软删除报价单
- 回算需求项 `quote_scope_status`
- 报价单删除在事务中执行。

## 10. 结算和统计

结算预览口径：

```text
已确认报价子项单价 × 任务资产个数
```

统计分析支持：

- 基金客户
- 对接人
- 业务平台
- 业务大类
- 二级分类
- 三级分类
- 员工

待报价口径包含：

- `not_started`
- `pending_confirm`
- `partial`
- `changed`

## 11. 数据巡检建议

可定期检查：

- 是否存在报价映射指向不存在的需求项。
- 是否存在报价映射指向不存在的报价子项。
- 需求项报价状态是否与映射状态一致。
- 报价子项挂靠状态是否与有效映射一致。
- 同基金同季度是否有多张需要人工选择的报价单。

## 12. 任务状态与交付闭环

任务状态由 `backend/src/tasks/task-status.ts` 统一定义和校验：

```text
todo -> assigned -> in_progress -> pending_review -> completed
                     ^              |
                     |              v
                   returned <- return_revision
```

关键触发点：

- 后台指派任务：`todo/pending/returned -> assigned`。
- 员工打开项目资产页：`todo/pending/assigned/returned -> in_progress`，带 `reopen=1` 时允许 `completed -> in_progress`。
- 员工提交本地资产或服务端同步飞书资产表：`assigned/in_progress/returned -> pending_review`。
- 管理者验收：`pending_review -> completed`。
- 管理者退回：`pending_review -> in_progress`，并记录退回说明。

每次状态变化都会写入 `task_status_histories`，字段包括 `task_id`、`from_status`、`to_status`、`trigger_source`、`remark`、`created_at`。

前端和通知统一读取 `workflow` 快照，不再各自猜下一步：

- `phase`：当前阶段。
- `nextAction` / `nextActionLabel`：下一步动作。
- `availableActions`：当前允许的动作。
- `canOpenAssetSheet`、`canSubmitDelivery`、`canReviewDelivery`、`canReopen`：关键按钮判断。

## 13. 字典、模型和飞书解耦

维度字典：

- 表：`dimension_dictionaries`
- 接口：`GET /api/v1/dimensions`、`GET /api/v1/dimensions/grouped`
- 默认种子：业务平台、业务大类、二级分类。

AI 提示词：

- 文件：`backend/src/ai-prompts/prompt-registry.ts`
- 当前 key：`requirement.context_match`、`requirement.splitter`、`quotation.parser`
- 每个提示词带 version，方便后续回滚和对比。

飞书集成拆分：

- `feishu-openapi.client.ts`：tenant token 和通用请求。
- `feishu-sheet.client.ts`：资产表创建、模板写入、授权、读取。
- `feishu-card-templates.ts`：卡片模板。
- `feishu-callback-parser.ts`：回调解析。
- `feishu-task-card-action.handler.ts`：任务卡片动作业务处理。
- `feishu-user-sync.service.ts`：通讯录员工同步。
