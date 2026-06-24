# 向量引擎管理工作台后端接口设计 API 清单

更新时间：2026-06-17

## 当前重点接口

### 静态页面

- `GET /`：登录、需求录入、任务指派、合同报价录入、报价子项选择、结算统计、需求面板页面。
- `GET /asset-sheet.html?taskId=<taskId>&taskNo=<taskNo>&token=<token>`：本地交付登记页，员工上传/粘贴图片资产并填写一个最终交付链接。

### 认证

- `GET /api/v1/auth/login-users`：登录页加载可登录用户的最小信息列表。
- `POST /api/v1/auth/password-login`：账号下拉 + 密码登录，返回 `accessToken`。
- `POST /api/v1/auth/login`：开发/应急选择用户登录，生产默认关闭。
- 受保护接口需携带 `Authorization: Bearer <accessToken>`。

### 需求与任务

- `POST /api/v1/requirements/with-task`：手动创建需求并自动生成一个任务。
- `GET /api/v1/requirements/business-category-owners`：查询业务大类负责人配置，返回大类编码、名称、负责人用户和状态。
- `PATCH /api/v1/requirements/business-category-owners/{categoryCode}`：更新某个业务大类的负责人；更新后会回填该业务大类历史任务的 `reporter_user_id`。
- `GET /api/v1/requirements/ai-preview-candidates?limit=12`：读取 AI 已识别但未确认的候选需求，并返回证据链。
- `POST /api/v1/requirements/ai-preview-candidates/{candidateId}/confirm`：将候选需求标记为已确认，避免正式录入后重复展示。
- `POST /api/v1/requirements/ai-preview-candidates/{candidateId}/reject`：将候选需求标记为伪需求，状态置为 `rejected`，AI 预览区不再展示。
- `POST /api/v1/requirements/ai-match-context`：根据文件内容匹配客户和业务大类。
- `POST /api/v1/requirements/ai-split-with-tasks`：使用 OpenAI 兼容模型拆分需求，并为每条需求生成任务。
- `PATCH /api/v1/requirements/{id}`：人工编辑历史需求任务，自动同步需求项和任务标题/描述/优先级。
- `DELETE /api/v1/requirements/{id}/bundle`：软删除需求、需求项、任务、工作目录和资产记录，并清理关联报价映射。
- `POST /api/v1/tasks/{id}/assign`：指派任务；`provisionWorkspace=true` 时创建资产入口并发送一条带按钮的飞书消息。
- `GET /api/v1/tasks/{id}/asset-sheet/context?token=<token>`：员工交付登记页加载任务上下文。
- `POST /api/v1/tasks/{id}/asset-sheet/upload-image?token=<token>`：上传本地图片，返回可保存的图片 URL。
- `POST /api/v1/tasks/{id}/asset-sheet/local-assets?token=<token>`：保存图片资产 URL 和单个最终交付链接，图片资产去重统计，并将任务推进到待验收。
- `POST /api/v1/tasks/{id}/asset-sheet/sync`：读取飞书在线表资产 URL 并同步统计。
- `GET /api/v1/tasks/board?liveAssetCount=true&customerCode=<customerCode>`：任务看板，支持实时资产数和基金客户筛选；`customerId` 仅保留兼容。
- `GET /api/v1/tasks/{id}/workflow`：返回任务、资产数、工作目录、最近状态历史和统一 workflow 快照。
- `GET /api/v1/tasks/{id}/status-history`：返回任务状态流转审计记录。

### 维度字典

- `GET /api/v1/contact-contexts`：查询群内对接人映射，底层按 `customer_code` 存储基金简称；兼容字段 `customer_id` 也返回基金简称。
- `POST /api/v1/contact-contexts`：新增群内对接人映射。
- `PATCH /api/v1/contact-contexts/{id}`：更新群内对接人映射。
- `GET /api/v1/dimensions`：查询维度字典，支持按 `dimensionType`、`parentValue`、`status` 过滤。
- `GET /api/v1/dimensions/grouped`：按类型分组返回业务平台、业务大类、二级分类等字典。
- `GET /api/v1/dimensions/business-category-relations`：返回业务大类与二级分类关系，用于需求录入二级分类联动。
- `POST /api/v1/dimensions`：新增或更新字典项。
- `PATCH /api/v1/dimensions/{id}`：更新字典项名称、排序、状态等。

### 飞书与通知

- `GET /api/v1/integrations/feishu/config`：查看飞书配置、推荐权限、资产表模式和本地入口公网可达性。
- `POST /api/v1/integrations/feishu/contacts/sync-users`：同步飞书员工到本地用户。
- `GET /api/v1/integrations/feishu/sync-logs`：查看飞书消息、表格创建、授权、同步日志。
- `POST /api/v1/notifications/result-file-missing-scan`：扫描缺失资产 URL 的任务并提醒负责人。
- `POST /api/v1/notifications/task-progress-feedback-scan`：扫描开始超过 2 天且未完成的已指派任务，提醒员工进入反馈页选择“进行中 / 已完成”。

### 报价、适配与结算

- `POST /api/v1/quotations/parse-text`：预览解析合同报价文本，返回将生成的细粒度报价子项。
- `POST /api/v1/quotations/import-text`：导入合同报价文本并生成合同报价与报价子项。
- `GET /api/v1/quotations/{id}/items`：查看合同报价子项。
- `POST /api/v1/quotations/{id}/items`：人工新增报价子项。
- `PATCH /api/v1/quotations/items/{itemId}`：编辑报价子项。
- `DELETE /api/v1/quotations/items/{itemId}`：删除报价子项，并清理关联映射和维度规则。
- `DELETE /api/v1/quotations/{id}`：软删除报价单及其子项，并清理关联映射和维度规则。
- `GET /api/v1/quote-mappings/quarter-workbench?customerCode=<code>&quarter=YYYY-Qn`：按基金和季度加载需求报价子项映射工作台；`customerId` 仅保留兼容。
- `GET /api/v1/quote-mappings/quarter-workbenches?customerCodes=<code1,code2>&quarter=YYYY-Qn`：批量加载多基金季度适配工作台，用于需求面板和结算统计减少多次请求。
- `POST /api/v1/quote-mappings/quarter-suggest`：按基金、季度和报价单生成需求项到报价子项的自动适配建议。
- `POST /api/v1/quote-mappings`：手工保存需求任务与报价子项映射，后端校验基金客户和报价子项归属；同一需求项重复保存会复用当前映射并将旧有效映射标记为 `obsolete`。
- `PATCH /api/v1/quote-mappings/{mappingId}`：保存或确认单条需求报价映射。
- `DELETE /api/v1/quote-mappings/{mappingId}`：删除单条需求报价映射，并同步需求项和报价子项状态。
- `GET /api/v1/quote-mappings/dimension-rules`：查看报价子项维度规则。
- `POST /api/v1/quote-mappings/dimension-rules`：创建报价子项维度规则。
- `PATCH /api/v1/quote-mappings/dimension-rules/{ruleId}`：更新报价子项维度规则。
- `DELETE /api/v1/quote-mappings/dimension-rules/{ruleId}`：删除报价子项维度规则。

## 1. 文档目标

本文档定义向量引擎管理工作台 V1 的后端 REST API 清单，供前后端联调、权限设计和服务拆分使用。

## 2. 设计约定

- 协议：HTTPS
- 风格：RESTful + 少量动作型接口
- Base Path：`/api/v1`
- 鉴权：管理后台使用账号下拉 + 密码登录；受保护接口统一校验访问 Token、角色权限和数据范围
- 返回格式：JSON
- 时间格式：ISO 8601
- 主键类型：UUID 字符串

统一响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

分页响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 100
  }
}
```

## 3. 认证与用户

## 3.1 认证

### `POST /auth/password-login`
- 说明：管理后台账号密码登录；账号使用员工 `display_name`，密码读取 `users.passwd`
- 入参：`account`、`password`
- 出参：`accessToken`、`tokenType`、`user`

### `POST /auth/login`
- 说明：开发/应急选择用户登录，仅在 `ALLOW_DEV_LOGIN=true` 或配置 `DEV_LOGIN_KEY` 时可用
- 入参：`username`、`loginKey`
- 出参：`accessToken`、`tokenType`、`user`

### `POST /auth/logout`
- 说明：登出

## 3.2 用户

### `GET /users/me`
- 说明：获取当前用户信息

### `GET /users`
- 说明：获取用户列表
- 权限：管理员 / 管理者 / 项目经理
- 查询：`keyword`、`status`、`roleCode`

### `GET /users/{userId}`
- 说明：获取用户详情

### `POST /users`
- 说明：创建用户

### `PATCH /users/{userId}`
- 说明：更新用户

### `GET /roles`
- 说明：获取角色列表

## 4. 工作台

### `GET /dashboard/overview`
- 说明：获取首页工作台数据
- 权限：登录用户
- 返回：
  - 进行中项目数
  - 待处理任务数
  - 逾期任务数
  - 待适配项数量
  - 待审核报价单数量
  - 本月收入 / 待结算金额

### `GET /dashboard/alerts`
- 说明：获取 AI 风险提醒和待办

### `GET /dashboard/metrics`
- 说明：获取经营指标卡片

## 5. 客户管理

### `GET /customers`
- 说明：客户列表
- 查询：`keyword`、`status`

### `POST /customers`
- 说明：创建客户

### `GET /customers/{customerId}`
- 说明：客户详情

### `PATCH /customers/{customerId}`
- 说明：更新客户

### `GET /customers/{customerId}/projects`
- 说明：查询客户下项目

## 6. 项目管理

### `GET /projects`
- 说明：项目列表
- 查询：`status`、`ownerUserId`、`customerId`、`keyword`

### `POST /projects`
- 说明：创建项目
- 关键字段：
  - `projectName`
  - `customerId`
  - `ownerUserId`
  - `projectType`
  - `budgetAmount`
  - `plannedEndDate`

### `GET /projects/{projectId}`
- 说明：项目详情

### `PATCH /projects/{projectId}`
- 说明：更新项目

### `POST /projects/{projectId}/archive`
- 说明：归档项目

### `GET /projects/{projectId}/overview`
- 说明：项目总览
- 返回：
  - 基础信息
  - 需求统计
  - 任务统计
  - 风险摘要
  - 报价摘要

### `GET /projects/{projectId}/members`
- 说明：项目成员列表

### `POST /projects/{projectId}/members`
- 说明：添加项目成员

### `DELETE /projects/{projectId}/members/{memberId}`
- 说明：移除项目成员

## 7. 需求管理

### `GET /requirements`
- 说明：需求列表
- 查询：`projectId`、`customerId`、`status`、`priority`、`sourceType`、`keyword`

### `POST /requirements`
- 说明：创建需求
- 关键字段：
  - `projectId`
  - `customerId`
  - `title`
  - `sourceType`
  - `rawContent`

### `POST /requirements/with-task`
- 说明：快速创建需求、确认一个需求项，并自动生成一个待指派任务；当前录入页采用“一个需求对应一个任务”的链路
- 关键字段：`projectId`、`customerId`、`title`、`rawContent`、`priority`、`estimatedHours`
- 返回：`requirement`、`item`、`task`
- 角色口径：按 `businessCategory` 查询 `business_category_owner_configs`，写入 `task.reporter_user_id` 作为需求负责人；任务执行人仍由后续指派动作写入 `task.assignee_user_id`。

### `GET /requirements/business-category-owners`
- 说明：查询业务大类负责人配置。
- 返回：`businessCategoryCode`、`businessCategoryName`、`ownerUserId`、`ownerName`、`ownerUsername`、`status`、`remark`。

### `PATCH /requirements/business-category-owners/{categoryCode}`
- 说明：更新业务大类负责人配置，并立即回填该大类历史任务的 `reporter_user_id`。
- 入参：`ownerUserId`
- 约束：`ownerUserId` 为空表示未配置负责人；非空时必须是 active 用户。

### `POST /requirements/ai-split-with-tasks`
- 说明：加载需求文件内容后，自动拆分为多条需求，并为每条需求生成一个待指派任务
- 关键字段：`projectId`、`customerId`、`rawContent`、`fileName`、`priority`、`estimatedHours`
- 返回：`mode`、`aiLogId`、`count`、`items[]`，其中每项包含 `requirement`、`item`、`task`
- 当前策略：优先使用 `.env` 中 `OPENAI_BASE_URL`、`OPENAI_API_KEY`、`OPENAI_MODEL` 调用 OpenAI 兼容 `chat/completions`；模型未配置或失败时回退本地规则拆分器
- 拆分口径：只提取客户真实需求；确认事项、跟进记录、进度反馈、催办和负责人安排不生成任务

### `POST /requirements/ai-match-context`
- 说明：AI 文件录入时，根据文件内容匹配客户和业务大类
- 关键字段：`rawContent`、`fileName`
- 返回：`customerId`、`customerName`、`projectType`、`projectTypeLabel`、`confidence`、`reason`、`mode`
- 当前策略：优先使用 OpenAI 兼容模型从客户池和业务大类选项中匹配；模型失败时回退客户名称和分类关键词规则

### `GET /requirements/{requirementId}`
- 说明：需求详情

### `PATCH /requirements/{requirementId}`
- 说明：更新需求基础信息

### `POST /requirements/{requirementId}/parse`
- 说明：触发 AI 需求解析
- 返回：
  - `aiLogId`
  - `structuredResult`

### `POST /requirements/{requirementId}/confirm`
- 说明：确认需求与结构化结果

### `GET /requirements/{requirementId}/versions`
- 说明：需求版本列表

### `POST /requirements/{requirementId}/versions`
- 说明：新增需求版本

## 8. 需求项管理

### `GET /requirement-items`
- 说明：需求项列表
- 查询：`requirementId`、`projectId`、`status`、`quoteScopeStatus`

### `POST /requirements/{requirementId}/items`
- 说明：新增需求项

### `PATCH /requirement-items/{itemId}`
- 说明：更新需求项

### `POST /requirement-items/{itemId}/confirm`
- 说明：确认需求项

### `POST /requirement-items/{itemId}/obsolete`
- 说明：废弃需求项

### `GET /requirement-items/{itemId}/mappings`
- 说明：查看需求项关联报价映射

## 9. 任务管理

### `GET /tasks`
- 说明：任务列表
- 查询：`projectId`、`assigneeUserId`、`status`、`requirementItemId`、`keyword`

### `POST /tasks`
- 说明：创建任务

### `POST /requirement-items/{itemId}/tasks`
- 说明：从需求项生成任务

### `GET /tasks/{taskId}`
- 说明：任务详情

### `PATCH /tasks/{taskId}`
- 说明：更新任务

### `POST /tasks/{taskId}/assign`
- 说明：指派任务，可选同步创建在线资产表和授权记录
- 入参：`assigneeUserId`、`provisionWorkspace`、`feishuFolderToken`、`directoryUrl`

### `GET /tasks/{taskId}/workspace`
- 说明：获取任务在线资产表入口和权限状态

### `POST /tasks/{taskId}/workspace/provision`
- 说明：创建或更新任务在线资产表授权记录
- 入参：`assigneeUserId`、`feishuFolderToken`、`directoryUrl`

### `POST /tasks/{taskId}/asset-sheet/sync`
- 说明：从飞书资产登记表读取图片资产地址，并同步为任务资产记录

### `GET /tasks/{taskId}/result-files`
- 说明：获取任务资产记录列表，兼容旧版结果文件表

### `GET /tasks/{taskId}/asset-sheet/context`
- 说明：员工交付登记页加载任务上下文
- 查询：`token`

### `POST /tasks/{taskId}/asset-sheet/upload-image`
- 说明：员工交付登记页上传图片，返回 `/uploads/task-assets/...` 图片 URL
- 查询：`token`
- 入参：`dataUrl`、`fileName`

### `POST /tasks/{taskId}/asset-sheet/local-assets`
- 说明：本地交付登记页保存时，把员工填写的图片资产和最终交付链接同步到后台统计
- 查询：`token`
- 入参：`assets[]`、`imageUrls[]`、`linkUrl`
- 约束：图片最多 80 张，资产 URL 最多 200 条，单个 URL 最长 500 字符；最终交付链接不计入结算资产个数

### `GET /tasks/{taskId}/progress-feedback/context`
- 说明：员工任务进度反馈页加载任务上下文
- 查询：`token`

### `POST /tasks/{taskId}/progress-feedback/status`
- 说明：员工从消息进入反馈页后选择任务进度
- 查询：`token`
- 入参：`status`，可选 `in_progress`、`completed`

### `POST /tasks/{taskId}/result-files`
- 说明：兼容旧版手动登记结果文件流程，当前主链路不再使用
- 入参：`fileName`、`fileUrl`、`feishuFileToken`、`uploadedByUserId`、`remark`

### `POST /tasks/{taskId}/status`
- 说明：修改任务状态
- 入参：`status`、`blockedReason`

### `POST /tasks/{taskId}/return-revision`
- 说明：验收退回修改，任务回到进行中，并通知任务负责人
- 入参：`reason`、`progressPercent`

### `POST /tasks/{taskId}/ai-assignment-suggestion`
- 说明：生成 AI 智能分配建议

### `GET /tasks/board`
- 说明：看板视图
- 查询：`projectId`、`liveAssetCount`
- 说明：`liveAssetCount=true` 时，会直接读取已开通飞书在线资产表中的图片资产 URL 个数，并同步为后台资产记录；读取失败时回退到后台缓存数量

### `GET /tasks/my`
- 说明：我的任务

## 10. 工时管理

### `GET /worklogs`
- 说明：工时列表
- 查询：`projectId`、`taskId`、`userId`、`dateFrom`、`dateTo`

### `POST /worklogs`
- 说明：新增工时

### `PATCH /worklogs/{worklogId}`
- 说明：编辑工时

### `DELETE /worklogs/{worklogId}`
- 说明：删除工时

### `POST /worklogs/{worklogId}/submit`
- 说明：提交工时

### `POST /worklogs/{worklogId}/approve`
- 说明：审批工时

## 11. 风险与周报

### `GET /risk-alerts`
- 说明：风险列表
- 查询：`projectId`、`status`、`severity`、`alertType`

### `POST /risk-alerts/detect`
- 说明：触发风险扫描
- 入参：`projectId`

### `POST /risk-alerts/{alertId}/acknowledge`
- 说明：确认风险

### `POST /risk-alerts/{alertId}/resolve`
- 说明：关闭风险

### `GET /weekly-reports`
- 说明：周报列表
- 查询：`projectId`、`reportWeek`、`status`

### `POST /weekly-reports/generate`
- 说明：AI 生成周报
- 入参：`projectId`、`reportWeek`

### `GET /weekly-reports/{reportId}`
- 说明：周报详情

### `PATCH /weekly-reports/{reportId}`
- 说明：编辑周报

### `POST /weekly-reports/{reportId}/send-feishu`
- 说明：发送周报到飞书

## 12. 需求报价子项映射

### `GET /quote-mappings/workbench`
- 说明：适配工作台数据
- 查询：`projectId`
- 返回：
  - 需求项列表
  - 任务与工时统计
  - 当前映射状态统计
  - 当前报价单草稿

### `POST /quote-mappings/suggest`
- 说明：生成需求报价子项映射建议
- 入参：`projectId`
- 返回：`aiLogId`、`mappingSuggestions`

### `GET /quote-mappings/quarter-workbench`
- 说明：按基金客户和季度加载需求报价子项映射工作台
- 查询：`customerId`、`quarter`、`quotationId?`
- 返回：季度内需求项、可选报价单、当前报价子项、已有映射、汇总指标

### `GET /quote-mappings/quarter-workbenches`
- 说明：批量加载多个基金客户的季度适配工作台，避免需求面板/结算统计按基金逐个请求
- 查询：`customerCodes` 逗号分隔、`quarter`
- 返回：`workbenches[]`、跨基金 `summary`
- 校验：`customerCodes` 不能为空，`quarter` 必须是 `YYYY-Qn`，例如 `2026-Q2`

### `POST /quote-mappings/quarter-suggest`
- 说明：按基金、季度和报价单自动建议需求项与报价子项的映射
- 入参：`customerId`、`quarter`、`quotationId`、`requirementItemIds?`
- 返回：`aiLogId`、`suggestions`、`workbench`

### `GET /quote-mappings`
- 说明：映射列表
- 查询：`projectId`、`requirementItemId`、`mappingStatus`

### `POST /quote-mappings`
- 说明：手工保存映射；同一需求项重复保存时复用当前映射，旧有效映射标记为 `obsolete`
- 校验：需求项必须属于项目；报价单客户必须与需求客户一致；报价子项必须属于所选报价单

### `PATCH /quote-mappings/{mappingId}`
- 说明：修改映射
- 校验：同创建映射；失效状态 `rejected/obsolete` 不再占用报价子项

### `DELETE /quote-mappings/{mappingId}`
- 说明：删除映射，并同步需求项和报价子项挂靠状态

### `POST /quote-mappings/{mappingId}/confirm`
- 说明：财务确认映射

### `POST /quote-mappings/batch-confirm`
- 说明：批量确认映射

### `GET /quote-mappings/diff/by-project/{projectId}`
- 说明：查看未匹配项 / 差异项

## 13. 合同报价管理

### `GET /quotations`
- 说明：合同报价列表
- 查询：`projectId`、`customerId`、`status`、`quotationNo`

### `POST /quotations`
- 说明：手工创建合同报价

### `POST /quotations/parse-text`
- 说明：预览解析合同报价文本，不落库
- 入参：`rawContent`、`fileName?`
- 返回：`items`、`totalAmount`、`summary`

### `POST /quotations/import-text`
- 说明：导入合同报价文本并生成合同报价与最细粒度报价子项
- 入参：`projectId`、`customerId`、`rawContent`、`fileName?`
- 返回：`quotation`、`items`、`summary`

### `POST /quotations/from-mappings`
- 说明：根据映射结果生成报价单草稿
- 入参：`projectId`、`mappingIds[]`

### `GET /quotations/{quotationId}`
- 说明：合同报价详情

### `PATCH /quotations/{quotationId}`
- 说明：更新合同报价头信息

### `DELETE /quotations/{quotationId}`
- 说明：软删除合同报价及报价子项，并清理关联报价映射和报价子项维度规则

### `POST /quotations/{quotationId}/items`
- 说明：新增报价项

### `PATCH /quotations/items/{quotationItemId}`
- 说明：修改报价项

### `DELETE /quotations/items/{quotationItemId}`
- 说明：删除报价项，并清理关联报价映射和报价子项维度规则

### `POST /quotations/{quotationId}/submit-review`
- 说明：提交审核

### `POST /quotations/{quotationId}/review`
- 说明：财务审核
- 入参：`approved`、`remark`

### `POST /quotations/{quotationId}/confirm-customer`
- 说明：标记客户已确认

### `POST /quotations/{quotationId}/export`
- 说明：导出报价单
- 返回：文件地址或任务ID

### `POST /quotations/{quotationId}/send-feishu`
- 说明：发送报价单到飞书

## 14. 变更单管理

### `GET /change-requests`
- 说明：变更单列表
- 查询：`projectId`、`status`、`changeType`

### `POST /change-requests`
- 说明：创建变更单

### `GET /change-requests/{changeRequestId}`
- 说明：变更单详情

### `PATCH /change-requests/{changeRequestId}`
- 说明：更新变更单

### `POST /change-requests/{changeRequestId}/assess`
- 说明：评估变更影响
- 返回：
  - 受影响需求项
  - 受影响任务
  - 受影响报价项
  - 金额差异

### `POST /change-requests/{changeRequestId}/confirm`
- 说明：确认变更单生效

### `GET /change-requests/{changeRequestId}/items`
- 说明：变更影响明细

## 15. 飞书集成

### `GET /integrations/feishu/config`
- 说明：获取飞书配置状态

### `POST /integrations/feishu/send/bot-message`
- 说明：发送机器人消息
- 入参：`text`、`objectType`、`objectId`、`feishuObjectType`、`feishuObjectId`

### `POST /integrations/feishu/send/app-message`
- 说明：通过企业自建应用向员工或群发送消息
- 入参：`receiveIdType`、`receiveId`、`text`、`objectType`、`objectId`
- 备注：`receiveIdType` 支持 `open_id/user_id/union_id/email/chat_id`

### `POST /integrations/feishu/contacts/sync-users`
- 说明：从飞书通讯录同步员工到本地用户表
- 入参：`departmentId`、`pageSize`
- 备注：默认从 `FEISHU_DEFAULT_DEPARTMENT_ID` 同步，根部门通常为 `0`

### `POST /integrations/feishu/webhook/events`
- 说明：飞书事件回调入口

### `GET /integrations/feishu/sync-logs`
- 说明：同步日志列表
- 查询：`objectType`、`objectId`、`status`

## 16. AI 助手

### `GET /ai/logs`
- 说明：AI 执行日志列表
- 查询：`sceneCode`、`projectId`、`objectType`

### `GET /ai/logs/{aiLogId}`
- 说明：AI 日志详情

### `POST /ai/requirement-parse`
- 说明：通用需求解析接口

### `POST /ai/task-assignment`
- 说明：通用任务分配建议接口

### `POST /ai/risk-detect`
- 说明：通用风险识别接口

### `POST /ai/quote-mapping`
- 说明：通用需求报价子项映射接口

### `POST /ai/quote-draft`
- 说明：通用报价草稿建议接口

### `POST /ai/suggestions/{aiLogId}/accept`
- 说明：记录 AI 建议采纳

### `POST /ai/suggestions/{aiLogId}/reject`
- 说明：记录 AI 建议拒绝

## 17. 审计与通用

### `GET /audit-logs`
- 说明：审计日志列表
- 查询：`objectType`、`objectId`、`operatorUserId`

### `GET /enum/options`
- 说明：获取前端所需状态枚举

### `GET /api/v1/health`
- 说明：健康检查

## 18. 核心对象最小响应字段

## 18.1 Project

```json
{
  "id": "uuid",
  "projectCode": "PRJ-202605-001",
  "projectName": "商城改版项目",
  "status": "in_progress",
  "customerId": "uuid",
  "ownerUserId": "uuid",
  "budgetAmount": 90000.00,
  "plannedEndDate": "2026-06-30"
}
```

## 18.2 RequirementItem

```json
{
  "id": "uuid",
  "requirementId": "uuid",
  "itemNo": "REQ-ITEM-01",
  "itemTitle": "商城首页改版",
  "status": "confirmed",
  "quoteScopeStatus": "in_scope",
  "estimatedHours": 32.00
}
```

## 18.3 Quotation

```json
{
  "id": "uuid",
  "quotationNo": "QT-202605-001",
  "projectId": "uuid",
  "status": "pending_review",
  "pricingBasis": "mapping",
  "totalAmount": 86800.00,
  "versionNo": 1
}
```

## 19. 推荐开发顺序

1. `auth`、`users`、`projects`
2. `requirements`、`requirement-items`
3. `tasks`、`worklogs`
4. `quote-mappings`
5. `quotations`
6. `change-requests`
7. `feishu integrations`
8. `ai logs`、`audit logs`

## 20. 消息通知接口

### `GET /notifications`
- 说明：消息列表
- 查询：`recipientUserId`、`status`

### `GET /notifications/{notificationId}`
- 说明：消息详情

### `POST /notifications/send`
- 说明：发送业务消息，默认写站内消息并尝试发送飞书应用消息
- 入参：`recipientUserId`、`title`、`content`、`objectType`、`objectId`、`channels`、`botText`、`actionUrl`、`actionText`
- 渠道：`in_app`、`feishu_app`、`feishu_bot`

### `POST /notifications/task-assignment`
- 说明：手动触发任务分配通知
- 入参：`taskId`、`message`

### `POST /notifications/{notificationId}/read`
- 说明：标记消息已读

### `POST /notifications/task-deadline-scan`
- 说明：扫描即将逾期和已逾期任务并发送提醒
- 入参：`projectId`、`daysAhead`

### `POST /notifications/result-file-missing-scan`
- 说明：兼容旧版结果文件流程，当前主链路不再使用
- 入参：`projectId`、`statuses`，`statuses` 默认 `pending_review,completed`

### `POST /notifications/feishu-sync-failure-scan`
- 说明：扫描飞书同步失败日志并提醒管理员
- 入参：`hours`
