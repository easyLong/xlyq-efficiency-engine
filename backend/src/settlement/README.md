# 结算明细 SQL 模板（首版）

结算金额概览继续沿用现有统计逻辑。选中基金后，明细表与 Excel 从同一个后端 SQL 模板取数；未配置模板的基金仍使用原通用明细。

服务启动时创建 `settlement_sql_templates`，首次为客户编码 `China Universal` 写入汇添富模板 v1。模板包含 `customer_code`、`template_code`、`name`、`version`、`status`、`sql_text` 和 `columns_json`。同一 `template_code` 可有多个版本；列表默认取已发布的最高版本。发布或回滚由数据库管理员维护，目前**没有网页 SQL 编辑器**。

SQL 必须是单条 `SELECT`，返回对外列配置所需的字段，并返回以下内部字段，供服务端绑定筛选和稳定分页：

- `__task_id`：任务 ID，必须唯一。
- `__customer_code`：基金编码。
- `__filter_date`：筛选日期。
- `__business_platform`、`__business_category`、`__secondary_category`、`__tertiary_category`：维度筛选值。

SQL 不从浏览器传入。服务端只接受模板 ID 和参数化筛选条件，权限为 `settlement.view_all`。预览每页 100 条，单次导出上限 5000 条。模板 SQL 虽有基本 SELECT 检查，但不是完整 SQL 沙箱；后续若开放在线编辑，必须先使用独立的只读数据库账号，并加入审核/发布流程。

汇添富 v1 按任务一行，包含零价格任务；`单价`、`总价`都取 `tasks.price_amount`，运营数量来自需求三级分类数量之和，其他业务默认 1。附图为交付图片链接。当前历史数据的零价格与空数量不会被自动修正。

## 新增基金模板

目前没有网页配置入口，新增模板由管理员直接写入 `settlement_sql_templates`。新增普通基金模板不需要更新代码；只有新增系统原本没有的字段、筛选维度或特殊 Excel 样式时才需要开发。

### 1. 查询基金编码

模板按客户编码匹配，不按客户名称匹配：

```sql
SELECT customer_code, customer_name, status
FROM customers
WHERE customer_name LIKE '%客户名称%';
```

只给 `status = 'active'` 的客户发布模板。例如汇添富的客户编码是 `China Universal`。

### 2. 准备模板 SQL

模板 SQL 必须满足以下要求：

- 是单条只读 `SELECT`，末尾不要写分号；
- 每一行对应一条结算明细，通常是一条任务；
- 必须返回以下内部字段，字段名不能改：

```text
__task_id
__customer_code
__filter_date
__business_platform
__business_category
__secondary_category
__tertiary_category
```

其中 `__filter_date` 参与顶部时间范围筛选；页面预览和 Excel 导出会使用完全相同的日期和维度条件。SQL 的其他字段为页面和 Excel 实际展示字段，例如：

```sql
SELECT
    t.id AS __task_id,
    r.customer_code AS __customer_code,
    DATE(COALESCE(t.actual_end_at, t.planned_end_at, r.created_at)) AS __filter_date,
    COALESCE(r.business_platform, '') AS __business_platform,
    COALESCE(r.business_category, '') AS __business_category,
    COALESCE(r.secondary_category, '') AS __secondary_category,
    COALESCE(r.tertiary_category, '') AS __tertiary_category,
    p.project_name AS project_name,
    t.price_amount AS total_price
FROM tasks t
JOIN requirement_items ri
    ON ri.id = t.requirement_item_id
   AND ri.deleted_at IS NULL
JOIN requirements r
    ON r.id = ri.requirement_id
   AND r.deleted_at IS NULL
JOIN projects p
    ON p.id = t.project_id
   AND p.deleted_at IS NULL
WHERE t.deleted_at IS NULL
```

### 3. 配置展示列

`columns_json` 的 `key` 必须对应 SQL 返回的字段别名，`label` 是页面和 Excel 表头：

```json
[
  {"key":"project_name","label":"名称","width":24},
  {"key":"total_price","label":"合计（含税）","width":16,"numeric":true}
]
```

支持的配置项：

| 配置项 | 说明 |
| --- | --- |
| `key` | SQL 字段别名，只能使用小写字母、数字和下划线 |
| `label` | 页面表头和 Excel 表头 |
| `width` | Excel 宽度，也会影响页面列宽 |
| `numeric` | 是否按数字显示；金额列设置为 `true` |

### 4. 写入并发布模板

```sql
SET @template_sql = '此处填写已验证的 SELECT SQL';

INSERT INTO settlement_sql_templates (
    id,
    customer_code,
    template_code,
    name,
    version,
    status,
    sql_text,
    columns_json
) VALUES (
    UUID(),
    '客户编码',
    '客户英文或业务编码_settlement',
    '客户名称结算明细',
    1,
    'published',
    @template_sql,
    JSON_ARRAY(
        JSON_OBJECT('key', 'project_name', 'label', '名称', 'width', 24),
        JSON_OBJECT('key', 'total_price', 'label', '合计（含税）', 'width', 16, 'numeric', true)
    )
);
```

`settlement_sql_templates` 表会在后端首次启动时自动创建。如果表不存在，先启动一次新版后端。模板记录写入后不需要重新编译，刷新结算统计页面即可生效。

### 5. 验证模板

按以下顺序检查：

1. 选择对应基金，确认明细表头与客户模板一致；
2. 切换“最近三个月、本月、上个月、不限”，确认行数会随顶部时间范围变化；
3. 设置业务平台或分类筛选，确认页面数据变化；
4. 点击“导出 Excel”，确认导出的列顺序与页面一致；
5. 检查金额、数量、空值和附图链接是否符合客户口径。

### 6. 修改模板和版本管理

模板发布后不要直接覆盖旧 SQL。修改时创建新版本，并将旧版本停用：

```sql
UPDATE settlement_sql_templates
SET status = 'archived'
WHERE template_code = '客户英文或业务编码_settlement'
  AND version = 1;

-- 然后插入同一个 template_code、version = 2 的新记录
```

同一个 `template_code` 建议只保留一个 `published` 版本。模板列表会优先展示已发布的最新版本。出现结果异常时，可将旧版本重新设为 `published`，再将问题版本设为 `archived`。

### 常见问题

- **选择基金后仍显示通用明细**：检查 `customer_code` 是否与 `customers.customer_code` 完全一致、模板是否为 `published`，并确认后端已经加载最新代码。
- **时间筛选没有效果**：检查 SQL 是否返回 `__filter_date`，且值为 `DATE` 或可比较的日期。
- **页面有列但没有数据**：检查 `columns_json.key` 是否与 SQL 字段别名完全一致。
- **模板 SQL 查不到数据**：先单独运行 SQL，再检查任务、需求项、需求和项目之间的关联是否完整。
- **SQL 执行安全**：不要把用户输入直接拼接进 SQL；模板只允许管理员配置，并应先在数据库中验证后再发布。
