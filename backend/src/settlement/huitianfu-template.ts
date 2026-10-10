export const HUITIANFU_TEMPLATE_CODE = 'china_universal';
export const HUITIANFU_TEMPLATE_VERSION = 8;
export { HUITIANFU_SQL } from './china-universal-sql';
export const HUITIANFU_CUSTOMER_CODE = 'China Universal';
export const HUAXIA_SETTLEMENT_TEMPLATE_CODE = 'china_amc_settlement';
export const HUAXIA_SETTLEMENT_TEMPLATE_VERSION = 2;
export const HUAXIA_SETTLEMENT_CUSTOMER_CODE = 'ChinaAMC';
export const XINGZHENG_SETTLEMENT_TEMPLATE_CODE = 'xingzheng_global_settlement';
export const XINGZHENG_SETTLEMENT_TEMPLATE_VERSION = 2;
export const XINGZHENG_SETTLEMENT_CUSTOMER_CODE = 'Xingzheng Global';
export const HAITONG_FUHAI_SETTLEMENT_TEMPLATE_CODE =
  'haitong_fuhai_settlement';
export const HAITONG_FUHAI_SETTLEMENT_TEMPLATE_VERSION = 2;
export const HAITONG_FUHAI_SETTLEMENT_CUSTOMER_CODE = 'Haitong Fuhai';
export const CHANGSHENG_SETTLEMENT_TEMPLATE_CODE = 'changsheng_settlement';
export const CHANGSHENG_SETTLEMENT_TEMPLATE_VERSION = 1;
export const CHANGSHENG_SETTLEMENT_CUSTOMER_CODE = 'Changsheng';
export const CICC_SETTLEMENT_TEMPLATE_CODE = 'cicc_settlement';
export const CICC_SETTLEMENT_TEMPLATE_VERSION = 1;
export const CICC_SETTLEMENT_CUSTOMER_CODE = 'CICC';
export const EFUND_SETTLEMENT_TEMPLATE_CODE = 'efund_settlement';
export const EFUND_SETTLEMENT_TEMPLATE_VERSION = 1;
export const EFUND_SETTLEMENT_CUSTOMER_CODE = 'E Fund';
export const DEFAULT_SETTLEMENT_TEMPLATE_CODE = 'default_settlement';
export const DEFAULT_SETTLEMENT_TEMPLATE_VERSION = 6;
export const DEFAULT_SETTLEMENT_CUSTOMER_CODE = '*';
export const DEFAULT_SETTLEMENT_TEMPLATE_NAME = '通用结算明细';

// The default template exposes stable task identifiers for the generic export.
// Fund, date, platform and category filters are added by SettlementService.
export const DEFAULT_SETTLEMENT_COLUMNS = [
  { key: 'usage_date', label: '结算日期', width: 15 },
  { key: 'customer_code', label: '基金编码', width: 22 },
  { key: 'project_name', label: '关联产品/项目', width: 24 },
  { key: 'requirement_code', label: '需求编号', width: 22 },
  { key: 'requirement_title', label: '需求标题', width: 30 },
  { key: 'task_no', label: '任务编号', width: 22 },
  { key: 'task_name', label: '任务标题', width: 30 },
  { key: 'primary_category', label: '业务大类', width: 18 },
  { key: 'secondary_category', label: '二级分类', width: 20 },
  { key: 'tertiary_category', label: '三级分类', width: 40 },
  { key: 'unit_price', label: '基金定价', width: 16, numeric: true },
  { key: 'quantity', label: '资产个数', width: 12, numeric: true },
  { key: 'total_price', label: '结算金额', width: 16, numeric: true },
  { key: 'requester_name', label: '需求提出人', width: 18 },
  { key: 'image_urls', label: '附图', width: 50 },
] as const;

export const HUITIANFU_COLUMNS = [
  { key: 'usage_date', label: '使用日期', width: 15 },
  { key: 'project_name', label: '关联产品/项目', width: 24 },
  { key: 'primary_category', label: '服务一级分类', width: 18 },
  { key: 'secondary_category', label: '服务二级分类', width: 20 },
  { key: 'tertiary_category', label: '服务三级分类', width: 40 },
  { key: 'contract_price', label: '合同价格', width: 16, numeric: true },
  { key: 'unit_price', label: '单价', width: 16, numeric: true },
  { key: 'quantity', label: '数量', width: 12, numeric: true },
  { key: 'discount_amount', label: '优惠金额', width: 16, numeric: true },
  { key: 'total_price', label: '总价', width: 16, numeric: true },
  { key: 'requester_name', label: '需求提出人', width: 18 },
  { key: 'image_urls', label: '附图', width: 50 },
] as const;

export const HUAXIA_SETTLEMENT_COLUMNS = [
  { key: 'settlement_year_month', label: '结算年月', width: 14 },
  { key: 'service_item', label: '服务项目', width: 24 },
  { key: 'project_name', label: '项目名称', width: 28 },
  { key: 'channel', label: '渠道', width: 14 },
  { key: 'contact_name', label: '对接人', width: 14 },
  { key: 'quantity', label: '数量', width: 10, numeric: true },
  { key: 'unit_price', label: '单价', width: 14, numeric: true },
  { key: 'amount', label: '金额', width: 14, numeric: true },
  {
    key: 'discount_rate',
    label: '折扣',
    width: 10,
    numeric: true,
    percent: true,
  },
  { key: 'amount_subtotal', label: '金额小计', width: 14, numeric: true },
  { key: 'remarks', label: '备注', width: 24, image: true },
] as const;

export const XINGZHENG_SETTLEMENT_COLUMNS = [
  { key: 'settlement_year_month', label: '结算年月', width: 14 },
  { key: 'service_type', label: '服务类型', width: 24 },
  { key: 'service_content', label: '服务内容', width: 42 },
  { key: 'remarks', label: '备注', width: 20 },
  { key: 'request_time', label: '需求时间', width: 14 },
  { key: 'delivery_time', label: '交付时间', width: 14 },
  { key: 'unit_price', label: '单价', width: 14, numeric: true },
  { key: 'quantity', label: '数量', width: 10, numeric: true },
  { key: 'fee', label: '费用', width: 14, numeric: true },
  { key: 'attachment_images', label: '附件号', width: 30, image: true },
  { key: 'contact_person', label: '对接人', width: 14 },
] as const;

export const HAITONG_FUHAI_SETTLEMENT_COLUMNS = [
  { key: 'project_category', label: '项目大类', width: 18 },
  { key: 'service_item', label: '服务项目', width: 40 },
  { key: 'service_form', label: '形式', width: 32 },
  { key: 'operating_platform', label: '运营平台', width: 16 },
  { key: 'involved_funds', label: '涉及基金', width: 48 },
  { key: 'requester_name', label: '需求人', width: 18 },
  { key: 'delivery_time', label: '交付时间', width: 16 },
  { key: 'quantity', label: '数量', width: 10, numeric: true },
  { key: 'unit_price', label: '单价', width: 14, numeric: true },
  { key: 'settlement_amount', label: '结算金额', width: 16, numeric: true },
  { key: 'delivery_attachments', label: '交付附件', width: 32, image: true },
] as const;

export const CHANGSHENG_SETTLEMENT_COLUMNS = [
  { key: 'delivery_time_service', label: '交付时间、服务项目', width: 36 },
  { key: 'subitem_description', label: '子项说明', width: 32 },
  { key: 'work_content', label: '工作内容', width: 42 },
  { key: 'delivery_materials', label: '交付物料', width: 32 },
  { key: 'quantity', label: '交付数量', width: 12, numeric: true },
  { key: 'total_price', label: '总价', width: 14, numeric: true },
  { key: 'attachments', label: '附件', width: 28, image: true },
] as const;

export const CICC_SETTLEMENT_COLUMNS = [
  { key: 'settlement_time', label: '结算时间', width: 16 },
  { key: 'product_service', label: '产品/服务', width: 28 },
  { key: 'project', label: '项目', width: 36 },
  { key: 'primary_category', label: '一级类别', width: 18 },
  { key: 'secondary_category', label: '二级类别', width: 20 },
  { key: 'tertiary_category', label: '三级类别', width: 36 },
  { key: 'quantity', label: '数量', width: 10, numeric: true },
  { key: 'unit_price', label: '单价', width: 14, numeric: true },
  { key: 'fee', label: '费用', width: 14, numeric: true },
  { key: 'screenshots', label: '截图', width: 28, image: true },
  { key: 'remarks', label: '备注', width: 32 },
] as const;

export const EFUND_SETTLEMENT_COLUMNS = [
  { key: 'settlement_time', label: '时间', width: 16 },
  { key: 'product_name', label: '产品名称', width: 24 },
  { key: 'material_form', label: '物料形式', width: 28 },
  {
    key: 'work_type',
    label: '新作/延展/修改',
    width: 18,
    headerWrap: true,
    headerHeight: 64,
  },
  { key: 'unit_cost', label: 'Unit Cost', width: 14, numeric: true },
  { key: 'quantity', label: 'Quantity', width: 12, numeric: true },
  { key: 'total_cost', label: 'Total Cost', width: 16, numeric: true },
  {
    key: 'personal_total',
    label: '个人总计',
    width: 16,
    numeric: true,
    mergeBy: '__efund_contact_group',
  },
  { key: 'customer_contact', label: '易方达对接人', width: 18 },
  { key: 'application_channel', label: '应用渠道(如有)', width: 20 },
  {
    key: 'issuance_stage',
    label: '新发/持营（是否标注发售日期）',
    width: 26,
    headerWrap: true,
    headerHeight: 64,
  },
  {
    key: 'vector_colleague',
    label: '向量对接同事',
    width: 20,
    mergeBy: '__efund_assignee_group',
  },
] as const;

// SQL returns stable field keys; customer/date/category filters are applied by the service.
// Keep one task per row. Prices come from the active fund price rule for each
// selected tertiary category; the task's manually entered price is ignored.
// JSON_TABLE text columns must use the business tables' collation explicitly;
// otherwise their collation follows the client connection and price joins fail.
export const DEFAULT_SETTLEMENT_SQL = `
SELECT
  t.id AS __task_id,
  r.customer_code AS __customer_code,
  DATE(COALESCE(t.planned_end_at, t.actual_end_at, r.created_at)) AS __filter_date,
  COALESCE(NULLIF(r.business_platform, ''), NULLIF(ctx.business_platform, ''), '未分类') AS __business_platform,
  COALESCE(NULLIF(d1.dimension_code, ''), NULLIF(r.business_category, ''), NULLIF(p.project_type, ''), '未分类') AS __business_category,
  COALESCE(NULLIF(d2.dimension_name, ''), NULLIF(r.secondary_category, ''), '未分类') AS __secondary_category,
  COALESCE(NULLIF(r.tertiary_category, ''), '未分类') AS __tertiary_category,
  DATE_FORMAT(COALESCE(t.planned_end_at, t.actual_end_at, r.created_at), '%Y-%m-%d') AS usage_date,
  r.customer_code AS customer_code,
  p.project_name AS project_name,
  r.requirement_code AS requirement_code,
  ri.item_title AS requirement_title,
  t.task_no AS task_no,
  t.task_name AS task_name,
  t.status AS task_status,
  t.assignee_user_id AS assignee_user_id,
  COALESCE(NULLIF(d1.dimension_name, ''), NULLIF(r.business_category, ''), NULLIF(p.project_type, ''), '未分类') AS primary_category,
  COALESCE(NULLIF(d2.dimension_name, ''), NULLIF(r.secondary_category, ''), '未分类') AS secondary_category,
  COALESCE(NULLIF(r.tertiary_category, ''), '未分类') AS tertiary_category,
  CAST(NULL AS DECIMAL(14, 2)) AS contract_price,
  CASE
    WHEN JSON_LENGTH(CASE WHEN JSON_VALID(r.tertiary_category_codes_json) THEN r.tertiary_category_codes_json ELSE '[]' END) = 1
    THEN (
      SELECT rule.unit_price
      FROM task_price_rules rule
      CROSS JOIN JSON_TABLE(
        CASE WHEN JSON_VALID(r.tertiary_category_codes_json) THEN r.tertiary_category_codes_json ELSE '[]' END,
        '$[*]' COLUMNS (tertiary_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$')
      ) AS one_code
      WHERE rule.customer_code IN (r.customer_code, '*')
        AND rule.business_category_code = COALESCE(d1.dimension_code, r.business_category, p.project_type, '')
        AND rule.secondary_category_code = COALESCE(d2.dimension_code, r.secondary_category, '')
        AND rule.tertiary_category_code = one_code.tertiary_code
        AND rule.status = 'active'
        AND rule.deleted_at IS NULL
        AND (rule.effective_from IS NULL OR rule.effective_from <= COALESCE(t.planned_end_at, t.actual_end_at, r.created_at, NOW()))
        AND (rule.effective_to IS NULL OR rule.effective_to >= COALESCE(t.planned_end_at, t.actual_end_at, r.created_at, NOW()))
      ORDER BY (rule.customer_code = r.customer_code) DESC, rule.version_no DESC, rule.effective_from DESC
      LIMIT 1
    )
    ELSE NULL
  END AS unit_price,
  (
    SELECT COALESCE(SUM(GREATEST(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(r.tertiary_category_quantities_json) THEN r.tertiary_category_quantities_json ELSE '{}' END, CONCAT('$.\"', codes.tertiary_code, '\"'))) AS DECIMAL(14, 2)), 1), 1)), 1)
    FROM JSON_TABLE(
      CASE WHEN JSON_VALID(r.tertiary_category_codes_json) THEN r.tertiary_category_codes_json ELSE '[]' END,
      '$[*]' COLUMNS (tertiary_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$')
    ) AS codes
  ) AS quantity,
  CAST(NULL AS DECIMAL(14, 2)) AS discount_amount,
  (
    SELECT COALESCE(SUM(
      COALESCE((
        SELECT rule.unit_price
        FROM task_price_rules rule
        WHERE rule.customer_code IN (r.customer_code, '*')
          AND rule.business_category_code = COALESCE(d1.dimension_code, r.business_category, p.project_type, '')
          AND rule.secondary_category_code = COALESCE(d2.dimension_code, r.secondary_category, '')
          AND rule.tertiary_category_code = codes.tertiary_code
          AND rule.status = 'active'
          AND rule.deleted_at IS NULL
        AND (rule.effective_from IS NULL OR rule.effective_from <= COALESCE(t.planned_end_at, t.actual_end_at, r.created_at, NOW()))
        AND (rule.effective_to IS NULL OR rule.effective_to >= COALESCE(t.planned_end_at, t.actual_end_at, r.created_at, NOW()))
        ORDER BY (rule.customer_code = r.customer_code) DESC, rule.version_no DESC, rule.effective_from DESC
        LIMIT 1
      ), 0) * GREATEST(COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(CASE WHEN JSON_VALID(r.tertiary_category_quantities_json) THEN r.tertiary_category_quantities_json ELSE '{}' END, CONCAT('$.\"', codes.tertiary_code, '\"'))) AS DECIMAL(14, 2)), 1), 1)
    ), 0)
    FROM JSON_TABLE(
      CASE WHEN JSON_VALID(r.tertiary_category_codes_json) THEN r.tertiary_category_codes_json ELSE '[]' END,
      '$[*]' COLUMNS (tertiary_code VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$')
    ) AS codes
  ) AS total_price,
  r.source_contact_name AS requester_name,
  (
    SELECT GROUP_CONCAT(
      DISTINCT CASE
        WHEN f.source IN ('local_asset_sheet_image', 'feishu_asset_sheet_image')
          OR LOWER(SUBSTRING_INDEX(f.file_name, '.', -1)) IN ('jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp')
        THEN f.file_url
      END SEPARATOR '\\n'
    )
    FROM task_result_files f
    WHERE f.task_id = t.id
      AND f.deleted_at IS NULL
      AND f.source IN ('local_asset_sheet', 'local_asset_sheet_image',
                       'feishu_asset_sheet', 'feishu_asset_sheet_image', 'manual', 'feishu')
  ) AS image_urls
FROM tasks t
JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
LEFT JOIN contact_context_configs ctx ON ctx.id = r.source_ref_id AND ctx.deleted_at IS NULL
LEFT JOIN dimension_dictionaries d1
  ON d1.dimension_type = 'business_category'
 AND (d1.dimension_code = r.business_category OR d1.dimension_name = r.business_category)
 AND d1.status = 'active' AND d1.deleted_at IS NULL
LEFT JOIN dimension_dictionaries d2
  ON d2.dimension_type = 'secondary_category'
 AND d2.parent_code = d1.dimension_code
 AND (d2.dimension_code = r.secondary_category OR d2.dimension_name = r.secondary_category)
 AND d2.status = 'active' AND d2.deleted_at IS NULL
WHERE t.deleted_at IS NULL
`;
