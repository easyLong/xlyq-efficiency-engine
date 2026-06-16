# AI 预览需求确认流程

更新时间：2026-06-16

## 目标

AI 预览需求用于承接外部识别流程已经写入数据库的候选需求。系统先在管理端展示候选需求和证据链，管理员点击单条候选后自动填充左侧手动录入表单，管理员可修改字段，确认后才正式写入 `requirements`、`requirement_items` 和 `tasks`。

这条链路和旧的“AI 文件录入”不同：当前不在页面上传文件，也不在前端触发解析；页面只读取已经入库的候选需求。

## 页面交互

入口位置：需求与指派页右侧，历史需求任务状态上方。

交互步骤：

1. 页面加载后调用 `GET /api/v1/requirements/ai-preview-candidates?limit=12`。
2. 右侧 `AI预览需求` 面板按一条候选需求一张横向卡片展示。
3. 卡片左侧显示候选摘要：群聊/客户、业务平台、业务分类、时间、置信度和状态。
4. 卡片右侧显示证据链：消息时间、发送人、消息文本和证据原因。
5. 点击卡片后，左侧切换到手动录入并自动填充字段。
6. 管理员可修改客户、平台、分类、时间、标题、内容等字段。
7. 点击 `确认需求` 后，复用现有 `POST /api/v1/requirements/with-task` 创建正式需求并生成待指派任务。
8. 创建成功后调用 `POST /api/v1/requirements/ai-preview-candidates/{candidateId}/confirm`，将候选状态标记为 `confirmed`。
9. 已确认候选不再出现在 AI 预览列表中。

## 数据来源

候选需求读取：

```sql
SELECT
  c.chat_name,
  c.customer_name,
  c.business_platform,
  d.id AS candidate_id,
  d.business_category,
  d.secondary_category,
  d.tertiary_category,
  d.start_time,
  d.deadline,
  d.business_name,
  d.demand_title,
  d.confidence,
  d.status,
  d.match_suggestion
FROM crawler_app.demand_intake_candidates d
JOIN crawler_app.wechat_chats c ON c.id = d.source_chat_id
WHERE COALESCE(d.status, 'pending') NOT IN ('confirmed', 'rejected')
ORDER BY d.created_at DESC
LIMIT ?;
```

证据链读取：

```sql
SELECT
  e.candidate_id,
  e.evidence_order,
  e.message_time,
  e.display_time_text,
  e.sender_name,
  e.message_text,
  e.screenshot_path,
  e.evidence_reason
FROM crawler_app.demand_candidate_evidence e
WHERE e.candidate_id IN (...)
ORDER BY e.candidate_id ASC, e.evidence_order ASC;
```

## 字段填充规则

| 表单字段 | 候选字段 | 说明 |
| --- | --- | --- |
| 客户 | `customer_name` / `chat_name` | 前端按客户名称和客户代码做模糊匹配，匹配不到时保留当前客户并提示管理员确认 |
| 业务平台 | `business_platform` | 如果选项不存在，前端临时加入该选项 |
| 业务大类 | `business_category` | 优先匹配系统业务大类字典的 value 或 label |
| 二级分类 | `secondary_category` | 按业务大类重新渲染二级分类下拉；候选值不存在时临时加入 |
| 三级分类 | `tertiary_category` | 写入人工可编辑输入框 |
| 开始时间 | `start_time` | 转为 `YYYY-MM-DD` |
| 截止时间 | `deadline` | 转为 `YYYY-MM-DD`，并触发优先级计算 |
| 业务命名 | `business_name` | 为空时兜底需求标题 |
| 需求标题 | `demand_title` | 为空时兜底业务命名 |
| 需求内容 | `demand_title`、`match_suggestion`、证据链 | 组合为可人工修改的正文 |

## 后端接口

### `GET /api/v1/requirements/ai-preview-candidates`

参数：

- `limit`：可选，默认 12，范围 1 到 100。

返回：

- 候选需求字段。
- `evidences`：该候选需求的证据链数组。

### `POST /api/v1/requirements/ai-preview-candidates/{candidateId}/confirm`

作用：

- 将 `crawler_app.demand_intake_candidates.status` 更新为 `confirmed`。

说明：

- 正式需求创建仍由 `POST /api/v1/requirements/with-task` 完成。
- 确认接口只负责回写候选状态，避免候选刷新后重复出现。

## 当前限制

- 候选表位于外部 schema `crawler_app`，当前通过 SQL 直连读取。
- 候选状态只做 `confirmed` / `rejected` 过滤，暂未记录正式需求 ID 回链。
- 截图路径 `screenshot_path` 已返回，但当前卡片只展示消息证据文本，未直接渲染截图。
- 客户匹配是前端模糊匹配，匹配不到时需要管理员手工选择。

## 验证

```bash
cd backend
npm run build
```

接口联调：

```bash
GET /api/v1/requirements/ai-preview-candidates?limit=3
POST /api/v1/requirements/ai-preview-candidates/{candidateId}/confirm
```
