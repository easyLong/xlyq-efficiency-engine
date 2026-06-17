const { randomUUID } = require('node:crypto');
const mysql = require('mysql2/promise');
require('dotenv').config();

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

async function ensureTables(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS demand_intake_candidates (
      id CHAR(36) NOT NULL,
      source_app VARCHAR(32) NOT NULL DEFAULT 'crawler',
      external_candidate_id VARCHAR(64) NULL,
      external_capture_run_id VARCHAR(64) NULL,
      external_source_key CHAR(64) NULL,
      external_chat_id VARCHAR(64) NULL,
      source_chat_name VARCHAR(255) NULL,
      raw_customer_name VARCHAR(128) NULL,
      raw_owner_name VARCHAR(255) NULL,
      raw_business_platform VARCHAR(64) NULL,
      business_category VARCHAR(64) NULL,
      secondary_category VARCHAR(64) NULL,
      tertiary_category VARCHAR(64) NULL,
      start_time DATETIME NULL,
      deadline DATETIME NULL,
      business_name VARCHAR(255) NULL,
      demand_title VARCHAR(255) NULL,
      demand_content LONGTEXT NULL,
      confidence DECIMAL(8,4) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      match_suggestion TEXT NULL,
      matched_customer_id CHAR(36) NULL,
      matched_contact_context_id CHAR(36) NULL,
      matched_business_platform VARCHAR(64) NULL,
      match_confidence DECIMAL(8,4) NULL,
      match_reason VARCHAR(500) NULL,
      confirmed_requirement_id CHAR(36) NULL,
      confirmed_task_id CHAR(36) NULL,
      confirmed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uk_demand_intake_external (source_app, external_candidate_id),
      KEY idx_demand_intake_status_created (status, created_at),
      KEY idx_demand_intake_capture (source_app, external_capture_run_id),
      KEY idx_demand_intake_source_key (source_app, external_source_key),
      KEY idx_demand_intake_external_chat (source_app, external_chat_id),
      KEY idx_demand_intake_matched_contact (matched_contact_context_id),
      KEY idx_demand_intake_confirmed_requirement (confirmed_requirement_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='候选需求接入表'
  `);
  await addColumnIfMissing(connection, 'demand_intake_candidates', 'demand_content', 'LONGTEXT NULL');
  await addColumnIfMissing(connection, 'demand_intake_candidates', 'external_capture_run_id', 'VARCHAR(64) NULL');
  await addColumnIfMissing(connection, 'demand_intake_candidates', 'external_source_key', 'CHAR(64) NULL');

  await connection.query(`
    CREATE TABLE IF NOT EXISTS demand_candidate_evidence (
      id CHAR(36) NOT NULL,
      candidate_id CHAR(36) NOT NULL,
      external_evidence_id VARCHAR(64) NULL,
      evidence_order INT NOT NULL DEFAULT 100,
      message_time DATETIME NULL,
      display_time_text VARCHAR(64) NULL,
      sender_name VARCHAR(128) NULL,
      message_text TEXT NULL,
      screenshot_path VARCHAR(500) NULL,
      evidence_reason TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_demand_evidence_external (candidate_id, external_evidence_id),
      KEY idx_demand_evidence_candidate_order (candidate_id, evidence_order),
      KEY idx_demand_evidence_external (external_evidence_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='候选需求证据链表'
  `);
}

async function addColumnIfMissing(connection, tableName, columnName, columnDefinition) {
  const [rows] = await connection.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
    `,
    [tableName, columnName],
  );
  if (Number(rows?.[0]?.count || 0) > 0) return;
  await connection.query(
    `ALTER TABLE ${quoteIdentifier(tableName)} ADD COLUMN ${quoteIdentifier(columnName)} ${columnDefinition}`,
  );
}

async function main() {
  const sourceDb = argValue(
    'source-db',
    process.env.CRAWLER_DB_NAME || 'crawler_app',
  );
  const limit = Math.max(
    1,
    Math.min(5000, Number(argValue('limit', '1000')) || 1000),
  );
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  await ensureTables(connection);

  const source = quoteIdentifier(sourceDb);
  const [candidates] = await connection.query(
    `
      SELECT
        d.id AS external_candidate_id,
        NULL AS external_capture_run_id,
        NULL AS external_source_key,
        d.source_chat_id AS external_chat_id,
        c.chat_name AS source_chat_name,
        c.customer_name AS raw_customer_name,
        c.owner_name AS raw_owner_name,
        c.business_platform AS raw_business_platform,
        d.business_category,
        d.secondary_category,
        d.tertiary_category,
        d.start_time,
        d.deadline,
        d.business_name,
        d.demand_title,
        d.demand_content,
        d.confidence,
        COALESCE(d.status, 'pending') AS status,
        d.match_suggestion,
        d.created_at
      FROM ${source}.demand_intake_candidates d
      JOIN ${source}.wechat_chats c ON c.id = d.source_chat_id
      WHERE COALESCE(d.status, 'pending') NOT IN ('confirmed', 'rejected')
      ORDER BY d.created_at DESC
      LIMIT ?
    `,
    [limit],
  );

  let candidateUpserts = 0;
  for (const row of candidates) {
    await connection.execute(
      `
        INSERT INTO demand_intake_candidates (
          id, source_app, external_candidate_id, external_chat_id,
          external_capture_run_id, external_source_key,
          source_chat_name, raw_customer_name, raw_owner_name, raw_business_platform,
          business_category, secondary_category, tertiary_category, start_time, deadline,
          business_name, demand_title, demand_content, confidence, status, match_suggestion, created_at
        ) VALUES (?, 'crawler', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()))
        ON DUPLICATE KEY UPDATE
          external_capture_run_id = IF(status IN ('confirmed', 'rejected'), external_capture_run_id, VALUES(external_capture_run_id)),
          external_source_key = IF(status IN ('confirmed', 'rejected'), external_source_key, VALUES(external_source_key)),
          external_chat_id = IF(status IN ('confirmed', 'rejected'), external_chat_id, VALUES(external_chat_id)),
          source_chat_name = IF(status IN ('confirmed', 'rejected'), source_chat_name, VALUES(source_chat_name)),
          raw_customer_name = IF(status IN ('confirmed', 'rejected'), raw_customer_name, VALUES(raw_customer_name)),
          raw_owner_name = IF(status IN ('confirmed', 'rejected'), raw_owner_name, VALUES(raw_owner_name)),
          raw_business_platform = IF(status IN ('confirmed', 'rejected'), raw_business_platform, VALUES(raw_business_platform)),
          business_category = IF(status IN ('confirmed', 'rejected'), business_category, VALUES(business_category)),
          secondary_category = IF(status IN ('confirmed', 'rejected'), secondary_category, VALUES(secondary_category)),
          tertiary_category = IF(status IN ('confirmed', 'rejected'), tertiary_category, VALUES(tertiary_category)),
          start_time = IF(status IN ('confirmed', 'rejected'), start_time, VALUES(start_time)),
          deadline = IF(status IN ('confirmed', 'rejected'), deadline, VALUES(deadline)),
          business_name = IF(status IN ('confirmed', 'rejected'), business_name, VALUES(business_name)),
          demand_title = IF(status IN ('confirmed', 'rejected'), demand_title, VALUES(demand_title)),
          demand_content = IF(status IN ('confirmed', 'rejected'), demand_content, VALUES(demand_content)),
          confidence = IF(status IN ('confirmed', 'rejected'), confidence, VALUES(confidence)),
          status = IF(status IN ('confirmed', 'rejected'), status, VALUES(status)),
          match_suggestion = IF(status IN ('confirmed', 'rejected'), match_suggestion, VALUES(match_suggestion)),
          deleted_at = IF(status IN ('confirmed', 'rejected'), deleted_at, NULL)
      `,
      [
        randomUUID(),
        String(row.external_candidate_id),
        row.external_chat_id ? String(row.external_chat_id) : null,
        row.external_capture_run_id ? String(row.external_capture_run_id) : null,
        row.external_source_key ? String(row.external_source_key) : null,
        row.source_chat_name ?? null,
        row.raw_customer_name ?? null,
        row.raw_owner_name ?? null,
        row.raw_business_platform ?? null,
        row.business_category ?? null,
        row.secondary_category ?? null,
        row.tertiary_category ?? null,
        row.start_time ?? null,
        row.deadline ?? null,
        row.business_name ?? null,
        row.demand_title ?? null,
        row.demand_content ?? null,
        row.confidence ?? null,
        row.status || 'pending',
        row.match_suggestion ?? null,
        row.created_at ?? null,
      ],
    );
    candidateUpserts += 1;
  }

  const externalIds = candidates.map((row) =>
    String(row.external_candidate_id),
  );
  let evidenceUpserts = 0;
  if (externalIds.length > 0) {
    const placeholders = externalIds.map(() => '?').join(', ');
    const [opsCandidates] = await connection.query(
      `
        SELECT id, external_candidate_id
        FROM demand_intake_candidates
        WHERE source_app = 'crawler'
          AND external_candidate_id IN (${placeholders})
      `,
      externalIds,
    );
    const candidateIdByExternalId = new Map(
      opsCandidates.map((row) => [String(row.external_candidate_id), row.id]),
    );
    const [evidences] = await connection.query(
      `
        SELECT
          e.id AS external_evidence_id,
          e.candidate_id AS external_candidate_id,
          e.evidence_order,
          e.message_time,
          e.display_time_text,
          e.sender_name,
          e.message_text,
          e.screenshot_path,
          e.evidence_reason
        FROM ${source}.demand_candidate_evidence e
        WHERE e.candidate_id IN (${placeholders})
        ORDER BY e.candidate_id ASC, e.evidence_order ASC
      `,
      externalIds,
    );
    for (const evidence of evidences) {
      const candidateId = candidateIdByExternalId.get(
        String(evidence.external_candidate_id),
      );
      if (!candidateId) continue;
      await connection.execute(
        `
          INSERT INTO demand_candidate_evidence (
            id, candidate_id, external_evidence_id, evidence_order,
            message_time, display_time_text, sender_name, message_text,
            screenshot_path, evidence_reason
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            evidence_order = VALUES(evidence_order),
            message_time = VALUES(message_time),
            display_time_text = VALUES(display_time_text),
            sender_name = VALUES(sender_name),
            message_text = VALUES(message_text),
            screenshot_path = VALUES(screenshot_path),
            evidence_reason = VALUES(evidence_reason)
        `,
        [
          randomUUID(),
          candidateId,
          evidence.external_evidence_id
            ? String(evidence.external_evidence_id)
            : null,
          evidence.evidence_order ?? 100,
          evidence.message_time ?? null,
          evidence.display_time_text ?? null,
          evidence.sender_name ?? null,
          evidence.message_text ?? null,
          evidence.screenshot_path ?? null,
          evidence.evidence_reason ?? null,
        ],
      );
      evidenceUpserts += 1;
    }
  }

  await connection.end();
  console.log(
    JSON.stringify(
      {
        sourceDb,
        targetDb: process.env.DB_NAME,
        candidates: candidateUpserts,
        evidences: evidenceUpserts,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
