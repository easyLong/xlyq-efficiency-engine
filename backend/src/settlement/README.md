# 结算明细 SQL 模板

结算金额概览继续沿用现有统计逻辑。选中基金后，模板预览与 Excel 从同一个后端 SQL 模板取数；没有已发布专用模板的基金使用通用默认模板，选择全部基金也使用默认模板。

服务启动时创建 `settlement_sql_templates`，并维护汇添富（`China Universal`）、华夏基金（`ChinaAMC`）、兴全基金（`Xingzheng Global`）、海富通（`Haitong Fuhai`）、长盛（`Changsheng`）、中金（`CICC`）、易方达（`E Fund`）和 `customer_code = '*'` 通用模板。默认模板查询全部基金，基金、时间、平台和分类均由服务层按页面选择追加筛选。模板包含 `customer_code`、`template_code`、`name`、`version`、`status`、`sql_text` 和 `columns_json`。同一 `template_code` 可有多个版本；列表默认取已发布的最高版本。发布或回滚由数据库管理员维护，目前**没有网页 SQL 编辑器**。

SQL 必须是单条 `SELECT`，返回对外列配置所需的字段，并返回以下内部字段，供服务端绑定筛选和稳定分页：

- `__task_id`：任务 ID，必须唯一。
- `__customer_code`：基金编码。
- `__filter_date`：筛选日期。
- `__business_platform`、`__business_category`、`__secondary_category`、`__tertiary_category`：维度筛选值。

SQL 不从浏览器传入。服务端只接受模板 ID 和参数化筛选条件，权限为 `settlement.view_all`。预览每页 100 条，单次导出上限 5000 条。模板 SQL 虽有基本 SELECT 检查，但不是完整 SQL 沙箱；后续若开放在线编辑，必须先使用独立的只读数据库账号，并加入审核/发布流程。

通用模板 v6、汇添富模板 v8、华夏模板 v2 按任务一行，包含未配置价格的任务；`单价`和`金额`按基金、业务大类、二级分类、三级分类匹配 `task_price_rules`，再按需求中的三级分类数量计算，不读取 `tasks.price_amount`。

## 长盛模板 v1 字段口径

长盛 SQL 位于 `changsheng-template.ts`，列为“交付时间、服务项目、子项说明、工作内容、交付物料、交付数量、总价、附件”。第一列将任务计划结束日期与需求业务名称合并显示；子项说明取需求明细说明，工作内容取任务说明，交付物料列出任务交付文件名，交付数量和总价使用三级分类数量及基金定价，附件嵌入最多两张本地图片。

## 中金模板 v1 字段口径

中金 SQL 位于 `cicc-template.ts`，列为“结算时间、产品/服务、项目、一级类别、二级类别、三级类别、数量、单价、费用、截图、备注”。结算时间使用计划结束日期优先的 `YYYY-MM-DD`；产品/服务取项目名称，项目取需求标题；类别取对应分类名称；数量、单价和费用使用三级分类数量及中金基金定价；截图嵌入最多两张本地图片；备注取需求摘要。

## 易方达模板 v1 字段口径

易方达 SQL 位于 `efund-template.ts`，按截图保留 12 列。时间取结算日期，产品名称取项目名称，物料形式取三级分类，单价和总价使用基金定价及需求数量，个人总计按易方达对接人汇总，易方达对接人取需求来源联系人，应用渠道取需求业务平台，向量对接同事取任务执行人。个人总计和执行人按相邻分组在 Excel 中合并；截图列嵌入最多两张本地图片。当前系统没有“新作/延展/修改”和“新发/持营”字段，这两列留空。

## 海富通模板 v1 字段口径

海富通 SQL 位于 `haitong-fuhai-template.ts`，按截图配置“项目大类、服务项目、形式、运营平台、涉及基金、需求人、交付时间、数量、单价、结算金额、交付附件”。项目大类取业务大类字典名，服务项目取需求标题，形式取三级分类，运营平台取需求平台，需求人取需求来源联系人，交付时间取任务计划结束日期，数量和定价取需求数量及基金定价规则，交付附件嵌入最多两张本地图片。当前没有独立的涉及基金字段，所以留空；海富通目前也没有有效基金定价规则，单价和结算金额会留空，需在基金定价中录入规则后显示。

## 华夏模板 v2 字段口径

华夏 SQL 位于 `huaxia-template.ts`，导出列按截图配置为“结算年月、服务项目、项目名称、渠道、对接人、数量、单价、金额、折扣、金额小计、备注”。结算年月使用计划结束日期优先的 `YYYY年M月` 格式；服务项目取需求业务名称，为空时回退二级分类；项目名称取需求标题；渠道取业务平台；对接人取需求来源联系人；数量读取三级分类数量，未填写按 1；价格使用基金定价；折扣目前固定为 0%；金额小计等于金额；备注嵌入任务交付的本地图片缩略图。一个单元格最多嵌入两张缩略图。

华夏目前有效基金定价规则只有 2 条，其余未配置分类的任务仍出现在导出中，但单价和金额留空。各级 SQL 字段名是服务端字段；Excel 表头由 `columns_json.label` 映射为截图中的中文标题。

## 兴全模板 v1 字段口径

兴全 SQL 位于 `xingzheng-template.ts`，列为“结算年月、服务类型、服务内容、备注、需求时间、交付时间、单价、数量、费用、附件号、对接人”。结算年月为计划结束时间优先的 `YYYY-MM`；服务类型取 `requirements.business_name`，为空时取二级分类；服务内容依次取需求明细说明、任务说明、需求明细标题；备注目前没有专属字段，留空；需求时间取任务计划开始时间，交付时间取任务计划结束时间，两者均显示 `YYYY-MM-DD`；单价和费用使用基金定价规则，数量取需求三级分类数量；附件号嵌入最多两张本地交付图片；对接人取需求来源联系人。

## 汇添富 v8 字段口径

汇添富 SQL 位于 `china-universal-sql.ts`，通用 SQL 位于 `huitianfu-template.ts` 的 `DEFAULT_SETTLEMENT_SQL`；服务启动时将内置版本同步至模板表。汇添富保留原有 12 列及其顺序：

| 字段               | 取值规则                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| 使用日期           | 优先计划结束时间，再取实际结束时间、需求创建时间；筛选使用相同日期                                           |
| 关联产品/项目      | 任务所属项目名称                                                                                             |
| 服务一级、二级分类 | 在对应父级下按编码或名称匹配字典；无法匹配时保留历史值                                                       |
| 服务三级分类       | 优先使用编码 JSON；缺失或为空时按历史名称拆分并在二级分类下匹配                                              |
| 合同价格           | 暂无独立合同价格来源，留空                                                                                   |
| 单价               | 单三级分类取基金定价；多三级分类取总金额除以总数量的加权平均值，保留两位小数                                 |
| 数量               | 汇总所选三级分类的填写数量，未填写默认 1；读取需求数量，不读取交付文件数                                     |
| 优惠金额           | 暂无优惠金额来源，留空                                                                                       |
| 总价               | 各三级分类的基金定价乘数量后汇总，保留两位小数；任一分类缺价或没有完整分类时留空，避免部分定价被当作完整金额 |
| 需求提出人         | 需求来源联系人姓名                                                                                           |
| 附图               | 交付图片链接去重后换行拼接                                                                                   |

定价优先当前基金，再取 `*` 的通用规则；同一优先级下取最高版本及最近生效日期，有效期按结算日期匹配，结束日期包含当天。SQL 不硬编码基金或时间，服务端参数化追加筛选；任一维度选择 `all` 时不添加该维度条件。多分类的单价仅用于显示，总价直接汇总各项金额，不用四舍五入后的平均单价重新计算。

模板中的 `JSON_TABLE` 文本列显式使用业务表的排序规则，避免数据库客户端采用 `utf8mb4_0900_ai_ci` 时与定价表的 `utf8mb4_unicode_ci` 产生比较冲突。自定义模板拆分三级分类编码时也应使用以下声明：

```sql
'$[*]' COLUMNS (
  tertiary_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$'
)
```

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
    DATE(COALESCE(t.planned_end_at, t.actual_end_at, r.created_at)) AS __filter_date,
    COALESCE(r.business_platform, '') AS __business_platform,
    COALESCE(r.business_category, '') AS __business_category,
    COALESCE(r.secondary_category, '') AS __secondary_category,
    COALESCE(r.tertiary_category, '') AS __tertiary_category,
    p.project_name AS project_name
    -- 生产模板会按基金和三级分类读取 task_price_rules，
    -- 再按三级分类数量计算 total_price，不读取 t.price_amount
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
  { "key": "project_name", "label": "名称", "width": 24 },
  {
    "key": "total_price",
    "label": "合计（含税）",
    "width": 16,
    "numeric": true
  }
]
```

支持的配置项：

| 配置项    | 说明                                         |
| --------- | -------------------------------------------- |
| `key`     | SQL 字段别名，只能使用小写字母、数字和下划线 |
| `label`   | 页面表头和 Excel 表头                        |
| `width`   | Excel 宽度，也会影响页面列宽                 |
| `numeric` | 是否按数字显示；金额列设置为 `true`          |

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
