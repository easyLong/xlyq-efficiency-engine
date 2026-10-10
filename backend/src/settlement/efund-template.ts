import { HUITIANFU_SQL } from './china-universal-sql';

// The E Fund export groups personal totals by the client contact and merges
// repeated contact and assignee cells in Excel. Work type and issuance stage
// remain empty because the current requirement/task model has no such fields.
export const EFUND_SETTLEMENT_SQL = `
SELECT
  e.__task_id AS __task_id,
  e.__customer_code AS __customer_code,
  e.__filter_date AS __filter_date,
  e.__business_platform AS __business_platform,
  e.__business_category AS __business_category,
  e.__secondary_category AS __secondary_category,
  e.__tertiary_category AS __tertiary_category,
  DATE_FORMAT(e.__filter_date, '%Y-%m-%d') AS settlement_time,
  COALESCE(NULLIF(e.project_name, ''), '') AS product_name,
  e.tertiary_category AS material_form,
  CAST(NULL AS CHAR(32)) AS work_type,
  e.unit_price AS unit_cost,
  e.quantity AS quantity,
  e.total_price AS total_cost,
  CASE
    WHEN COUNT(e.total_price) OVER (PARTITION BY e.__efund_contact_group) =
      COUNT(*) OVER (PARTITION BY e.__efund_contact_group)
    THEN SUM(e.total_price) OVER (PARTITION BY e.__efund_contact_group)
    ELSE NULL
  END AS personal_total,
  e.requester_name AS customer_contact,
  NULLIF(e.__business_platform, '未分类') AS application_channel,
  CAST(NULL AS CHAR(32)) AS issuance_stage,
  COALESCE(NULLIF(e.assignee_name, ''), '') AS vector_colleague,
  e.__efund_contact_group AS __efund_contact_group,
  e.__efund_assignee_group AS __efund_assignee_group
FROM (
  SELECT
    v.__task_id,
    v.__customer_code,
    v.__filter_date,
    v.__business_platform,
    v.__business_category,
    v.__secondary_category,
    v.__tertiary_category,
    v.project_name,
    v.unit_price,
    v.quantity,
    v.total_price,
    v.requester_name,
    v.assignee_user_id,
    COALESCE(NULLIF(v.requester_name, ''), CONCAT('task:', v.__task_id)) AS __efund_contact_group,
    CONCAT(
      COALESCE(NULLIF(v.requester_name, ''), CONCAT('task:', v.__task_id)),
      '|',
      COALESCE(NULLIF(v.assignee_user_id, ''), CONCAT('task:', v.__task_id))
    ) AS __efund_assignee_group,
    u.display_name AS assignee_name
  FROM (${HUITIANFU_SQL}) AS v
  LEFT JOIN users u ON u.id = v.assignee_user_id AND u.deleted_at IS NULL
) AS e
`;
