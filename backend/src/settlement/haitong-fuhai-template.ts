import { HUITIANFU_SQL } from './china-universal-sql';

// Match the visible Hai Fu Tong export columns. The source system has no
// structured involved-funds field, so that column stays blank until one exists.
export const HAITONG_FUHAI_SETTLEMENT_SQL = `
SELECT
  v.__task_id AS __task_id,
  v.__customer_code AS __customer_code,
  v.__filter_date AS __filter_date,
  v.__business_platform AS __business_platform,
  v.__business_category AS __business_category,
  v.__secondary_category AS __secondary_category,
  v.__tertiary_category AS __tertiary_category,
  v.primary_category AS project_category,
  COALESCE(NULLIF(r.title, ''), NULLIF(ri.item_title, ''), t.task_name) AS service_item,
  v.tertiary_category AS service_form,
  COALESCE(NULLIF(v.__business_platform, ''), '未设置') AS operating_platform,
  CAST(NULL AS CHAR(1000)) AS involved_funds,
  COALESCE(NULLIF(r.source_contact_name, ''), '') AS requester_name,
  DATE_FORMAT(t.planned_end_at, '%Y/%c/%e') AS delivery_time,
  v.quantity AS quantity,
  v.unit_price AS unit_price,
  v.total_price AS settlement_amount,
  v.image_urls AS delivery_attachments
FROM (${HUITIANFU_SQL}) AS v
JOIN tasks t ON t.id = v.__task_id AND t.deleted_at IS NULL
JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
`;
