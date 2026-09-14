export const HUITIANFU_TEMPLATE_CODE = 'china_universal';
export const HUITIANFU_CUSTOMER_CODE = 'China Universal';

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

// SQL returns stable field keys; customer/date/category filters are applied by the service.
// Keep one task per row. Unit price and total price intentionally both use task.price_amount.
export const HUITIANFU_SQL = `
SELECT
  t.id AS __task_id,
  r.customer_code AS __customer_code,
  DATE(COALESCE(t.actual_end_at, t.planned_end_at, r.created_at)) AS __filter_date,
  COALESCE(r.business_platform, ctx.business_platform, '') AS __business_platform,
  COALESCE(d1.dimension_code, r.business_category, p.project_type, '') AS __business_category,
  COALESCE(d2.dimension_name, r.secondary_category, '') AS __secondary_category,
  COALESCE(r.tertiary_category, '') AS __tertiary_category,
  DATE_FORMAT(t.actual_end_at, '%Y-%m-%d') AS usage_date,
  p.project_name AS project_name,
  COALESCE(d1.dimension_name, r.business_category, p.project_type) AS primary_category,
  COALESCE(d2.dimension_name, r.secondary_category) AS secondary_category,
  r.tertiary_category AS tertiary_category,
  CAST(NULL AS DECIMAL(14, 2)) AS contract_price,
  t.price_amount AS unit_price,
  CASE
    WHEN COALESCE(d1.dimension_code, r.business_category, p.project_type) IN ('operation', '运营')
    THEN (
      SELECT COALESCE(SUM(GREATEST(COALESCE(j.qty, 1), 1)), 1)
      FROM JSON_TABLE(
        CASE
          WHEN JSON_VALID(r.tertiary_category_quantities_json)
          THEN r.tertiary_category_quantities_json
          ELSE '{}'
        END,
        '$.*' COLUMNS (qty INT PATH '$')
      ) AS j
    )
    ELSE 1
  END AS quantity,
  CAST(NULL AS DECIMAL(14, 2)) AS discount_amount,
  t.price_amount AS total_price,
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
