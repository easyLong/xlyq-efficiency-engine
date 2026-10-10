import { HUITIANFU_SQL } from './china-universal-sql';

// The shared query supplies classification, category quantities, fund pricing,
// settlement date and delivery images. This template maps those fields to the
// 华夏 Excel layout without hardcoding a date or applying a fund filter in SQL.
export const HUAXIA_SETTLEMENT_SQL = `
SELECT
  v.__task_id AS __task_id,
  v.__customer_code AS __customer_code,
  v.__filter_date AS __filter_date,
  v.__business_platform AS __business_platform,
  v.__business_category AS __business_category,
  v.__secondary_category AS __secondary_category,
  v.__tertiary_category AS __tertiary_category,
  DATE_FORMAT(v.__filter_date, '%Y年%c月') AS settlement_year_month,
  COALESCE(NULLIF(r.business_name, ''), NULLIF(v.secondary_category, ''), '未分类') AS service_item,
  COALESCE(NULLIF(r.title, ''), NULLIF(v.requirement_title, ''), v.task_name, '') AS project_name,
  COALESCE(NULLIF(v.__business_platform, ''), '') AS channel,
  COALESCE(NULLIF(r.source_contact_name, ''), '') AS contact_name,
  v.quantity AS quantity,
  v.unit_price AS unit_price,
  v.total_price AS amount,
  CAST(0 AS DECIMAL(7, 4)) AS discount_rate,
  CASE WHEN v.total_price IS NULL THEN NULL ELSE v.total_price END AS amount_subtotal,
  v.image_urls AS remarks
FROM (${HUITIANFU_SQL}) AS v
JOIN tasks t ON t.id = v.__task_id AND t.deleted_at IS NULL
JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
`;
