import { HUITIANFU_SQL } from './china-universal-sql';

// Map the shared task-level settlement data to CICC's requested export fields.
export const CICC_SETTLEMENT_SQL = `
SELECT
  v.__task_id AS __task_id,
  v.__customer_code AS __customer_code,
  v.__filter_date AS __filter_date,
  v.__business_platform AS __business_platform,
  v.__business_category AS __business_category,
  v.__secondary_category AS __secondary_category,
  v.__tertiary_category AS __tertiary_category,
  DATE_FORMAT(v.__filter_date, '%Y-%m-%d') AS settlement_time,
  COALESCE(NULLIF(v.project_name, ''), '') AS product_service,
  COALESCE(NULLIF(r.title, ''), NULLIF(v.requirement_title, ''), v.task_name, '') AS project,
  v.primary_category AS primary_category,
  v.secondary_category AS secondary_category,
  v.tertiary_category AS tertiary_category,
  v.quantity AS quantity,
  v.unit_price AS unit_price,
  v.total_price AS fee,
  v.image_urls AS screenshots,
  COALESCE(NULLIF(r.summary, ''), '') AS remarks
FROM (${HUITIANFU_SQL}) AS v
JOIN tasks t ON t.id = v.__task_id AND t.deleted_at IS NULL
JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
`;
