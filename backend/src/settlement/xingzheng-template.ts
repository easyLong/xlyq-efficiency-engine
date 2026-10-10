import { HUITIANFU_SQL } from './china-universal-sql';

// Match the Xingzheng export layout while using the shared fund-price,
// quantity, settlement-date, category and delivery-image rules.
export const XINGZHENG_SETTLEMENT_SQL = `
SELECT
  v.__task_id AS __task_id,
  v.__customer_code AS __customer_code,
  v.__filter_date AS __filter_date,
  v.__business_platform AS __business_platform,
  v.__business_category AS __business_category,
  v.__secondary_category AS __secondary_category,
  v.__tertiary_category AS __tertiary_category,
  DATE_FORMAT(v.__filter_date, '%Y-%m') AS settlement_year_month,
  COALESCE(NULLIF(r.business_name, ''), NULLIF(v.secondary_category, ''), '未分类') AS service_type,
  COALESCE(NULLIF(ri.item_description, ''), NULLIF(t.description, ''), NULLIF(ri.item_title, ''), r.title) AS service_content,
  CAST(NULL AS CHAR(255)) AS remarks,
  DATE_FORMAT(t.planned_start_at, '%Y-%m-%d') AS request_time,
  DATE_FORMAT(t.planned_end_at, '%Y-%m-%d') AS delivery_time,
  v.unit_price AS unit_price,
  v.quantity AS quantity,
  v.total_price AS fee,
  v.image_urls AS attachment_images,
  COALESCE(NULLIF(r.source_contact_name, ''), '') AS contact_person
FROM (${HUITIANFU_SQL}) AS v
JOIN tasks t ON t.id = v.__task_id AND t.deleted_at IS NULL
JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
`;
