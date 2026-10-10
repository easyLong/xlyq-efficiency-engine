// Keep the leading SELECT so this query follows the template service's read-only
// contract. Runtime filters wrap the query; no fund or date is hardcoded here.
export const HUITIANFU_SQL = `
SELECT settlement.*
FROM (
  WITH task_base AS (
    SELECT
      t.id AS task_id,
      r.customer_code,
      DATE(COALESCE(t.planned_end_at, t.actual_end_at, r.created_at)) AS settlement_date,
      COALESCE(NULLIF(r.business_platform, ''), NULLIF(ctx.business_platform, ''), '未分类') AS business_platform,
      COALESCE(NULLIF(d1.dimension_code, ''), NULLIF(r.business_category, ''), NULLIF(p.project_type, ''), '') AS business_category_code,
      COALESCE(NULLIF(d1.dimension_name, ''), NULLIF(r.business_category, ''), NULLIF(p.project_type, ''), '未分类') AS primary_category,
      COALESCE(NULLIF(d2.dimension_code, ''), NULLIF(r.secondary_category, ''), '') AS secondary_category_code,
      COALESCE(NULLIF(d2.dimension_name, ''), NULLIF(r.secondary_category, ''), '未分类') AS secondary_category,
      p.project_name,
      r.requirement_code,
      ri.item_title AS requirement_title,
      t.task_no,
      t.task_name,
      t.status AS task_status,
      t.assignee_user_id,
      r.source_contact_name AS requester_name,
      CASE
        WHEN JSON_TYPE(CASE WHEN JSON_VALID(r.tertiary_category_codes_json) THEN r.tertiary_category_codes_json ELSE '[]' END) = 'ARRAY'
          AND JSON_LENGTH(CASE WHEN JSON_VALID(r.tertiary_category_codes_json) THEN r.tertiary_category_codes_json ELSE '[]' END) > 0
        THEN r.tertiary_category_codes_json
        ELSE COALESCE(CONCAT('[',
          REPLACE(JSON_QUOTE(REPLACE(REPLACE(NULLIF(TRIM(r.tertiary_category), ''), '、', ','), '，', ',')), ',', '","'),
          ']'), '[]')
      END AS codes_json,
      CASE WHEN JSON_VALID(r.tertiary_category_quantities_json)
        THEN r.tertiary_category_quantities_json ELSE '{}' END AS quantities_json
    FROM tasks t
    JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
    JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
    JOIN projects p ON p.id = t.project_id AND p.deleted_at IS NULL
    LEFT JOIN contact_context_configs ctx ON ctx.id = r.source_ref_id AND ctx.deleted_at IS NULL
    LEFT JOIN dimension_dictionaries d1 ON d1.id = (
      SELECT category.id FROM dimension_dictionaries category
      WHERE category.dimension_type = 'business_category'
        AND (category.dimension_code = COALESCE(NULLIF(r.business_category, ''), p.project_type)
          OR category.dimension_name = COALESCE(NULLIF(r.business_category, ''), p.project_type))
        AND category.status = 'active' AND category.deleted_at IS NULL
      ORDER BY (category.dimension_code = COALESCE(NULLIF(r.business_category, ''), p.project_type)) DESC, category.id
      LIMIT 1
    )
    LEFT JOIN dimension_dictionaries d2 ON d2.id = (
      SELECT category.id FROM dimension_dictionaries category
      WHERE category.dimension_type = 'secondary_category'
        AND category.parent_code = d1.dimension_code
        AND (category.dimension_code = r.secondary_category OR category.dimension_name = r.secondary_category)
        AND category.status = 'active' AND category.deleted_at IS NULL
      ORDER BY (category.dimension_code = r.secondary_category) DESC, category.id
      LIMIT 1
    )
    WHERE t.deleted_at IS NULL
  ), category_lines AS (
    SELECT b.*,
      codes.ordinal,
      NULLIF(TRIM(codes.tertiary_code), '') AS raw_tertiary_code,
      COALESCE(d3.dimension_code, NULLIF(TRIM(codes.tertiary_code), '')) AS tertiary_code,
      COALESCE(d3.dimension_name, NULLIF(TRIM(codes.tertiary_code), '')) AS tertiary_name,
      GREATEST(COALESCE(CAST(JSON_UNQUOTE(COALESCE(
        JSON_EXTRACT(b.quantities_json, CONCAT('$.', JSON_QUOTE(COALESCE(d3.dimension_code, TRIM(codes.tertiary_code))))),
        JSON_EXTRACT(b.quantities_json, CONCAT('$.', JSON_QUOTE(TRIM(codes.tertiary_code))))
      )) AS DECIMAL(14, 2)), 1), 1) AS quantity
    FROM task_base b
    LEFT JOIN JSON_TABLE(CAST(b.codes_json AS JSON), '$[*]' COLUMNS (
      ordinal FOR ORDINALITY,
      tertiary_code VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PATH '$' NULL ON ERROR
    )) codes ON TRUE
    LEFT JOIN dimension_dictionaries d3 ON d3.id = (
      SELECT category.id FROM dimension_dictionaries category
      WHERE category.dimension_type = 'tertiary_category'
        AND category.parent_code = b.secondary_category_code
        AND (category.dimension_code = TRIM(codes.tertiary_code) OR category.dimension_name = TRIM(codes.tertiary_code))
        AND category.status = 'active' AND category.deleted_at IS NULL
      ORDER BY (category.dimension_code = TRIM(codes.tertiary_code)) DESC, category.id
      LIMIT 1
    )
  ), priced_lines AS (
    SELECT line_item.*, rule.id AS rule_id, rule.unit_price
    FROM category_lines line_item
    LEFT JOIN task_price_rules rule ON rule.id = (
      SELECT candidate.id FROM task_price_rules candidate
      WHERE candidate.customer_code IN (line_item.customer_code, '*')
        AND candidate.business_category_code = line_item.business_category_code
        AND candidate.secondary_category_code = line_item.secondary_category_code
        AND candidate.tertiary_category_code = line_item.tertiary_code
        AND candidate.status = 'active' AND candidate.deleted_at IS NULL
        AND (candidate.effective_from IS NULL OR candidate.effective_from <= line_item.settlement_date)
        AND (candidate.effective_to IS NULL OR candidate.effective_to >= line_item.settlement_date)
      ORDER BY (candidate.customer_code = line_item.customer_code) DESC,
        candidate.version_no DESC, candidate.effective_from DESC, candidate.updated_at DESC, candidate.id
      LIMIT 1
    )
  )
  SELECT
    b.task_id AS __task_id,
    b.customer_code AS __customer_code,
    b.settlement_date AS __filter_date,
    b.business_platform AS __business_platform,
    COALESCE(NULLIF(b.business_category_code, ''), '未分类') AS __business_category,
    b.secondary_category AS __secondary_category,
    COALESCE(GROUP_CONCAT(b.tertiary_name ORDER BY b.ordinal SEPARATOR '、'), '未分类') AS __tertiary_category,
    CASE WHEN COUNT(b.raw_tertiary_code) = 0 OR COUNT(b.rule_id) < COUNT(*) THEN 1 ELSE 0 END AS __price_missing,
    DATE_FORMAT(b.settlement_date, '%Y-%m-%d') AS usage_date,
    b.customer_code,
    b.project_name,
    b.requirement_code,
    b.requirement_title,
    b.task_no,
    b.task_name,
    b.task_status,
    b.assignee_user_id,
    b.primary_category,
    b.secondary_category,
    COALESCE(GROUP_CONCAT(b.tertiary_name ORDER BY b.ordinal SEPARATOR '、'), '未分类') AS tertiary_category,
    CAST(NULL AS DECIMAL(14, 2)) AS contract_price,
    CASE WHEN COUNT(b.raw_tertiary_code) > 0 AND COUNT(b.rule_id) = COUNT(*)
      THEN ROUND(SUM(b.unit_price * b.quantity) / SUM(b.quantity), 2) ELSE NULL END AS unit_price,
    SUM(b.quantity) AS quantity,
    CAST(NULL AS DECIMAL(14, 2)) AS discount_amount,
    CASE WHEN COUNT(b.raw_tertiary_code) > 0 AND COUNT(b.rule_id) = COUNT(*)
      THEN ROUND(SUM(b.unit_price * b.quantity), 2) ELSE NULL END AS total_price,
    b.requester_name,
    (
      SELECT GROUP_CONCAT(DISTINCT CASE
        WHEN f.source IN ('local_asset_sheet_image', 'feishu_asset_sheet_image')
          OR LOWER(SUBSTRING_INDEX(f.file_name, '.', -1)) IN ('jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp')
        THEN f.file_url END SEPARATOR '\\n')
      FROM task_result_files f
      WHERE f.task_id = b.task_id AND f.deleted_at IS NULL
        AND f.source IN ('local_asset_sheet', 'local_asset_sheet_image', 'feishu_asset_sheet',
          'feishu_asset_sheet_image', 'manual', 'feishu')
    ) AS image_urls
  FROM priced_lines b
  GROUP BY b.task_id, b.customer_code, b.settlement_date, b.business_platform,
    b.business_category_code, b.primary_category, b.secondary_category_code,
    b.secondary_category, b.project_name, b.requirement_code, b.requirement_title,
    b.task_no, b.task_name, b.task_status, b.assignee_user_id, b.requester_name
) settlement
`;
