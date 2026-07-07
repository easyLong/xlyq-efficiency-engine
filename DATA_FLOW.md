# 数据链路说明

更新时间：2026-06-26

本文档说明当前系统中“需求、任务、资产、报价、结算”的真实数据链路和一致性规则。

## 1. 主链路

```text
group_contact_mappings
  -> business_category_owner_configs
  -> requirements
  -> requirement_items
  -> tasks
  -> task_directories / task_result_files
  -> quotations
  -> quotation_items
  -> quotation_item_dimension_rules
  -> requirement_quotation_mappings
  -> 结算统计 / 需求面板
```

## 2. 需求录入链路

需求候选来自群采集，录入时优先根据群和群内对接人识别上下文。

群内对接人映射表 `group_contact_mappings` 当前只明确带出：

- 基金客户：`customer_code`，业务链路直接使用基金简称，不再写入 `customer_id`
- 业务平台：`business_platform`

需求录入页的客户下拉显示全部 active 客户；报价、映射和结算场景仍优先使用公募基金客户。系统启动时会默认补入 `VectorEngine / 向量引擎`，并在 `group_contact_mappings` 中补入 `雷声 -> 向量引擎 / 其它` 的无群手工对接人映射，用于内部项目类需求录入。

匹配口径：

- 群唯一标识 `group_key` 决定基金客户。
- 群内 `contact_name` 决定业务平台。
- `group_key + contact_name` 唯一确定一条上下文。

业务大类和二级分类不再存放在群内对接人映射中，改由 `business_category_secondary_categories` 维护固定关系；录入时选择业务大类后，二级分类下拉联动。

保存需求时写入：

- `requirements`
- `requirement_items`
- `tasks`

当前录入链路约定：一条需求生成一个需求项和一个任务。

角色口径：

- `business_category_owner_configs.owner_user_id`：只按业务大类配置需求负责人；配置值会规范化为真实 `users.id` 后写入 `tasks.reporter_user_id`。
- `tasks.reporter_user_id`：需求负责人，创建任务时按业务大类自动写入；如果该大类未配置负责人，则保持为空并在页面显示“未配置负责人”。
- `tasks.assignee_user_id`：执行人，由历史需求任务状态页的“指派/改派”动作写入。

AI 预览需求确认链路：

```text
ops_platform.demand_intake_candidates
  -> ops_platform.demand_candidate_evidence
  -> 管理端 AI预览需求卡片
  -> 点击卡片填充手动录入表单
  -> 管理员修改并确认
  -> requirements / requirement_items / tasks
  -> 回写候选状态 confirmed
```

AI 候选需求在管理员确认前不进入正式需求库；确认后仍复用手动录入的创建接口，保证需求、需求项、任务的数据口径一致。候选状态只展示 `pending`；人工标记伪需求会将候选状态置为 `rejected`，并从预览区移除。

伪需求复核链路：

```text
AI预览需求卡片
  -> 标记伪需求
  -> 选择原因 / 填写补充说明 / 是否进入提示词优化样本
  -> demand_intake_candidates.review_note / match_reason
  -> demand_candidate_review_logs
```

`demand_candidate_review_logs` 保留候选快照、原因编码、原因中文标签、补充说明和复核人，后续可用于分析误识别类型并优化 AI 识别提示词。

## 3. 业务维度

需求、筛选、统计统一使用这些维度：

| 维度 | 来源优先级 |
| --- | --- |
| 基金客户 | `requirements.customer_code` |
| 对接人 | `requirements.source_ref_id` 指向 `group_contact_mappings.id` |
| 业务平台 | `requirements.business_platform`，兜底群内对接人映射 |
| 业务大类 | `requirements.business_category` |
| 二级分类 | `requirements.secondary_category`，受业务大类约束 |
| 员工/执行人 | `tasks.assignee_user_id` |

业务平台来自维度字典 `dimension_dictionaries.dimension_type = business_platform`，默认种子：

- 招行
- 工行
- 交行
- 理财通
- 蚂蚁
- 天天基金
- 京东金融
- 其它

业务大类和二级分类：

| 大类 | 二级分类 |
| --- | --- |
| 设计 | 配图拓展、banner新设计、巨幅新设计、长图新设计、长图拓展、长图套模板、其他 |
| 文案 | 数据更新、已有素材新编辑、原创文案、共建文案、其他 |
| 运营 | 发布陪伴、活动配置、魔秀搭建、页面推厂、直播配置、其他 |
| 社区 | 粉丝投放、精华贴、氛围贴、其他 |

三级分类字段仍保留用于兼容旧数据和人工备注，但不再作为需求面板、结算统计的全局筛选维度。

## 4. 任务和资产链路

任务指派后：

- `tasks.assignee_user_id` 记录执行人。
- `tasks.reporter_user_id` 保留需求负责人，不随指派/改派变化。
- 系统尝试创建飞书在线资产表。
- 飞书权限不足或本地兜底时，生成 `public/asset-sheet.html` 入口。
- 本地交付入口会携带任务访问 token：`asset-sheet.html?taskId=<taskId>&taskNo=<taskNo>&token=<token>`。
- 员工可上传、拖拽、粘贴图片，也可粘贴图片 URL；同时支持添加多条合作链接，合作链接可以不填。
- 资产登记页顶部提供 `个人任务主页`，仅写入执行人临时会话并跳转个人任务视图，不触发资产保存或提交。
- 后台统一写入 `task_result_files`。
- 员工提交资产或服务端同步飞书资产表后，任务进入 `pending_review`，系统按 `tasks.reporter_user_id` 通知负责人查看交付资产；如果任务负责人为空，才兜底使用项目负责人。
- 负责人通过飞书卡片或管理后台进入 `asset-review.html` 查看资产。该页面只展示交付资产、需求信息和验收动作，不复用执行人的资产提交页。

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
- `local_asset_sheet_link` / `feishu_asset_sheet_link`：合作链接，可多条，只用于交付追踪，不计入结算资产个数。
- 本地交付登记保存使用事务，保存成功后任务进入 `pending_review`。
- 资产查看页支持两种访问方式：飞书通知携带负责人专用 token 免登录进入；管理后台已登录负责人/管理员点击“查看资产”进入。

资产 PPT 导出口径：

```text
结算统计筛选出的任务
  -> requirement_quotation_mappings(mapping_status = matched)
  -> quotation_items.item_name 层级
  -> task_result_files 图片资产
  -> assets.pptx
```

导出的 PPT 标题为“基金名称-结算项目”。正文按报价子项层级顺序展示，例如 `运营支持 > 线上银行平台日常运营 > 设计`，每个层级下直接放置原始图片资产，图片下方显示真实图片名称；合作链接和非图片文件不进入 PPT。

## 5. 合同报价链路

合同报价录入页面只选择：

- 基金客户
- 合同开始月份和结束月份
- 合同报价文件/文本

报价合同可能覆盖多个业务大类，不要求导入时选择业务大类。同一家基金可维护多份不同期间的合同，月份入库为 `yyyy-MM`，页面展示为 `yyyyMM~yyyyMM`，例如 `万家基金合同报价(202401~202501)`；系统编号如 `QT-20260630-0001` 仅作为副标题和唯一编号。CSV 文件优先走结构化解析：一行一条报价子项，识别最细粒度子项、单位、单价；层级字段按原表顺序拼接，最后一个层级和备注放入子项详情。

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

1. 按需求所属基金客户加载该基金合同报价。
2. 人工先选择合同，再联动展示该合同下的报价子项。
3. 保存 `requirement_quotation_mappings`。同一需求项重复保存时复用当前映射，旧有效映射标记为 `obsolete`。
4. 回写：
   - `requirement_items.quote_scope_status`
   - `quotation_items.match_status`

后端校验：

- 需求项必须属于传入项目。
- 报价单客户必须等于需求客户。
- 报价子项必须属于所选报价单。
- 跨基金报价映射会被拒绝。

季度适配工作台优先按合同期间覆盖关系筛选报价单；历史未维护合同期间的报价单继续按创建时间落在季度内兜底。

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

失效映射不再占用报价子项，也不参与 `requirement_items.quote_scope_status` 与 `quotation_items.match_status` 计算。

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

结算统计口径：

```text
已确认报价子项单价 × 任务图片资产个数
```

需求面板支持：

- 基金客户
- 业务平台
- 业务大类
- 二级分类
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
- 系统发送“任务待验收”通知给任务负责人，飞书卡片按钮为“查看交付资产”。
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
- 大类二级关系表：`business_category_secondary_categories`
- 接口：`GET /api/v1/dimensions`、`GET /api/v1/dimensions/grouped`
- 默认种子：业务平台、业务大类、二级分类，以及大类与二级分类的固定关系；字典默认种子只补缺失项，不覆盖已有字典配置。
- 需求录入的业务平台下拉优先读取 `GET /api/v1/dimensions?type=business_platform`，表内 `status = active` 才会显示；接口失败时回退到前端默认平台。

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

## 14. 查询性能与一致性保护

服务启动时会通过 `schema-maintenance.ts` 安全补齐部分高频索引，索引不存在才创建：

- `requirements`：客户/项目与创建时间、需求编号。
- `requirement_items`：需求 ID、报价状态、需求项编号。
- `tasks`：项目、需求项、执行人状态、状态截止时间、任务编号。
- `customers`：客户主数据；系统默认补入 `VectorEngine / 向量引擎` 作为内部项目客户，默认对接人为雷声。
- `task_result_files`：任务、资产来源、软删除时间。
- `quotations` / `quotation_items`：客户、项目、报价编号、报价子项排序、匹配状态。
- `requirement_quotation_mappings`：需求项、项目状态、报价子项状态。
- `group_contact_mappings`：群、群内对接人、基金客户、业务平台、采集状态。

历史需求看板只限制最新需求数量；这些需求下的需求项、任务和报价映射完整拉取，避免全局分页截断导致状态不一致。
## 2026-07-01 群管理与合同报价整理补充

### 群管理链路

群管理页面直接维护 `group_contact_mappings`，用于让需求录入和 AI 候选需求确认时能根据群、基金、平台和对接人快速定位上下文。

新增群的业务流程为：

```text
拉 DP 入群 -> 新增群信息 -> DP 微信号备注客户真名
```

关键字段：

- `group_key`：系统自动生成的群标识，前端不再人工填写。
- `group_name`：微信群名称。
- `customer_code`：基金客户编码，关联 `customers.customer_code`。
- `business_platform`：业务平台。
- `group_nickname`：微信群里用于定位 DP 微信号的昵称。
- `contact_name`：真实对接人姓名。
- `nickname_updated`：是否已经把 DP 微信备注改为客户真名；页面按钮完成后置灰。
- `status`：是否启用，当前筛选默认查看启用数据。

一行群映射可以表示“某个群中的某个对接人”，同一个微信群如有多个对接人，可维护多行，共用 `group_name` 和 `group_key`，但 `contact_name` 不同。
群管理页面展示时按 `group_name` 聚合为“一群一行”，对接人、群昵称、基金和平台在同一行汇总展示；需求录入和 AI 候选匹配仍使用拆分后的单个对接人，保存时记录具体映射 `id`。`manual_` 开头的无群手工需求方映射仅用于需求录入，不进入群管理列表。

新增群时，`contactName` 和 `groupNickname` 支持以下分隔符配置多个值：英文逗号、中文逗号、顿号、英文分号、中文分号和 `|`。系统会对每个分隔项执行 `trim()`，因此 `张三, 李四` 和 `张三，李四` 都会拆成两个对接人；仅使用空格不会触发拆分。
多个对接人时，群昵称数量必须与对接人数量一致；平台在底层保存为空，列表展示为“全部平台”。

### 合同报价录入规范

人工录入合同报价时继续写入：

- `projects`
- `quotations`
- `quotation_items`

报价子项编码统一使用短格式：

```text
ITEM-001
ITEM-002
...
```

不要在 `quotation_items.item_code` 中拼接基金简称、年份或合同编号；合同归属由 `quotation_id` 决定，短编码更利于页面展示和人工核对。

报价子项名称建议只保留可匹配层级，例如：

```text
运营服务 > 线上物料设计 > 长图新设计
```

长服务说明、字数范围、屏数限制、结算条件等放入 `quotation_items.remark`。区间价、按实际需求定价、询价项统一按可变价处理：`pricing_mode = variable`、`unit_price = 0`、`match_status = price_missing`。
