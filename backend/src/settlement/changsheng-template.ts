import { HUITIANFU_SQL } from './china-universal-sql';

// Keep Changsheng's requested order and labels. Prices and quantities use the
// shared task price rules; the attachment column embeds available local images.
export const CHANGSHENG_SETTLEMENT_SQL = `
SELECT
  v.__task_id AS __task_id,
  v.__customer_code AS __customer_code,
  v.__filter_date AS __filter_date,
  v.__business_platform AS __business_platform,
  v.__business_category AS __business_category,
  v.__secondary_category AS __secondary_category,
  v.__tertiary_category AS __tertiary_category,
  CONCAT_WS(
    ' / ',
    DATE_FORMAT(t.planned_end_at, '%Y-%m-%d'),
    COALESCE(NULLIF(r.business_name, ''), NULLIF(v.secondary_category, ''))
  ) AS delivery_time_service,
  COALESCE(NULLIF(ri.item_description, ''), NULLIF(ri.item_title, ''), '') AS subitem_description,
  COALESCE(NULLIF(t.description, ''), NULLIF(t.task_name, ''), NULLIF(r.title, ''), '') AS work_content,
  (
    SELECT GROUP_CONCAT(DISTINCT NULLIF(TRIM(f.file_name), '') ORDER BY f.file_name SEPARATOR '\\n')
    FROM task_result_files f
    WHERE f.task_id = v.__task_id
      AND f.deleted_at IS NULL
  ) AS delivery_materials,
  v.quantity AS quantity,
  v.total_price AS total_price,
  v.image_urls AS attachments
FROM (${HUITIANFU_SQL}) AS v
JOIN tasks t ON t.id = v.__task_id AND t.deleted_at IS NULL
JOIN requirement_items ri ON ri.id = t.requirement_item_id AND ri.deleted_at IS NULL
JOIN requirements r ON r.id = ri.requirement_id AND r.deleted_at IS NULL
`;
