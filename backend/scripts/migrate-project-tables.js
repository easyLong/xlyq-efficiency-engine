#!/usr/bin/env node
const path = require('node:path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const TABLES = [
  'users',
  'roles',
  'user_roles',
  'customers',
  'contact_context_configs',
  'projects',
  'ai_execution_logs',
  'project_members',
  'requirements',
  'requirement_versions',
  'requirement_items',
  'tasks',
  'worklogs',
  'task_directories',
  'task_result_files',
  'notification_messages',
  'risk_alerts',
  'weekly_reports',
  'quotations',
  'quotation_items',
  'quotation_item_dimension_rules',
  'change_requests',
  'change_request_items',
  'requirement_quotation_mappings',
  'feishu_object_links',
  'feishu_sync_logs',
  'ai_suggestion_actions',
  'audit_logs',
];

function usage() {
  console.log(`
Usage:
  npm run migrate:project-tables -- --execute

Required target env:
  TARGET_DB_NAME

Optional target env:
  TARGET_DB_HOST      Defaults to DB_HOST
  TARGET_DB_PORT      Defaults to DB_PORT or 3306
  TARGET_DB_USER      Defaults to DB_USER
  TARGET_DB_PASSWORD  Defaults to DB_PASSWORD

Source env defaults to DB_* from backend/.env. You may override with SOURCE_DB_*.

Options:
  --execute            Write data to the target database. Without this, dry-run only.
  --truncate-target    Delete target table data before copying. Dangerous.
  --allow-non-empty    Allow copying into non-empty target tables.
  --tables=a,b,c       Copy only a subset from the known project table list.
  --help               Show this help.
`);
}

function parseArgs(argv) {
  const args = {
    execute: false,
    truncateTarget: false,
    allowNonEmpty: false,
    tables: TABLES,
  };
  for (const arg of argv) {
    if (arg === '--help') {
      args.help = true;
    } else if (arg === '--execute') {
      args.execute = true;
    } else if (arg === '--truncate-target') {
      args.truncateTarget = true;
    } else if (arg === '--allow-non-empty') {
      args.allowNonEmpty = true;
    } else if (arg.startsWith('--tables=')) {
      const requested = arg
        .slice('--tables='.length)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      const unknown = requested.filter((table) => !TABLES.includes(table));
      if (unknown.length) {
        throw new Error(`Unknown table(s): ${unknown.join(', ')}`);
      }
      args.tables = TABLES.filter((table) => requested.includes(table));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return args;
}

function env(name, fallbackName) {
  return process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
}

function sourceConfig() {
  return {
    host: env('SOURCE_DB_HOST', 'DB_HOST'),
    port: Number(env('SOURCE_DB_PORT', 'DB_PORT') || 3306),
    user: env('SOURCE_DB_USER', 'DB_USER'),
    password: env('SOURCE_DB_PASSWORD', 'DB_PASSWORD'),
    database: env('SOURCE_DB_NAME', 'DB_NAME'),
  };
}

function targetConfig() {
  return {
    host: env('TARGET_DB_HOST', 'DB_HOST'),
    port: Number(env('TARGET_DB_PORT', 'DB_PORT') || 3306),
    user: env('TARGET_DB_USER', 'DB_USER'),
    password: env('TARGET_DB_PASSWORD', 'DB_PASSWORD'),
    database: process.env.TARGET_DB_NAME,
  };
}

function assertConfig(label, config) {
  const missing = ['host', 'user', 'database'].filter((key) => !config[key]);
  if (config.password === undefined) missing.push('password');
  if (missing.length) {
    throw new Error(`${label} DB config missing: ${missing.join(', ')}`);
  }
}

function q(name) {
  return `\`${name.replaceAll('`', '``')}\``;
}

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
    [table],
  );
  return rows.length > 0;
}

async function rowCount(connection, table) {
  const [rows] = await connection.query(`SELECT COUNT(*) AS count FROM ${q(table)}`);
  return Number(rows[0].count);
}

async function showCreateTable(connection, table) {
  const [rows] = await connection.query(`SHOW CREATE TABLE ${q(table)}`);
  return rows[0]['Create Table'];
}

async function columns(connection, table) {
  const [rows] = await connection.query(`SHOW COLUMNS FROM ${q(table)}`);
  return rows.map((row) => row.Field);
}

async function ensureTargetSchema(source, target, tables, execute) {
  const existingTables = [];
  const missingOnSource = [];
  const missingOnTarget = [];

  if (execute) {
    await target.query('SET FOREIGN_KEY_CHECKS = 0');
  }
  try {
    for (const table of tables) {
      if (!(await tableExists(source, table))) {
        missingOnSource.push(table);
        continue;
      }
      existingTables.push(table);
      if (!(await tableExists(target, table))) {
        missingOnTarget.push(table);
        if (execute) {
          await target.query(await showCreateTable(source, table));
        }
      }
    }
  } finally {
    if (execute) {
      await target.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  }

  if (missingOnSource.length) {
    console.warn(`Skipped missing source table(s): ${missingOnSource.join(', ')}`);
  }
  if (missingOnTarget.length) {
    console.log(
      `${execute ? 'Created' : 'Would create'} target table(s): ${missingOnTarget.join(', ')}`,
    );
  }
  return { tables: existingTables, missingOnTarget };
}

async function assertCompatibleColumns(source, target, tables) {
  for (const table of tables) {
    const sourceColumns = await columns(source, table);
    const targetColumns = await columns(target, table);
    const missing = sourceColumns.filter((column) => !targetColumns.includes(column));
    if (missing.length) {
      throw new Error(
        `Target table ${table} missing source column(s): ${missing.join(', ')}`,
      );
    }
  }
}

async function truncateTargetTables(target, tables) {
  await target.query('SET FOREIGN_KEY_CHECKS = 0');
  try {
    for (const table of [...tables].reverse()) {
      await target.query(`DELETE FROM ${q(table)}`);
    }
  } finally {
    await target.query('SET FOREIGN_KEY_CHECKS = 1');
  }
}

async function copyTable(source, target, table, execute) {
  const [rows] = await source.query(`SELECT * FROM ${q(table)}`);
  if (!execute || rows.length === 0) {
    return rows.length;
  }

  const batchSize = 200;
  const columns = Object.keys(rows[0]);
  const columnSql = columns.map(q).join(', ');
  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize);
    const valueSql = batch
      .map(() => `(${columns.map(() => '?').join(', ')})`)
      .join(', ');
    const values = batch.flatMap((row) =>
      columns.map((column) => normalizeValue(row[column])),
    );
    await target.query(`INSERT INTO ${q(table)} (${columnSql}) VALUES ${valueSql}`, values);
  }
  return rows.length;
}

function normalizeValue(value) {
  if (
    value &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Buffer.isBuffer(value)
  ) {
    return JSON.stringify(value);
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const sourceDb = sourceConfig();
  const targetDb = targetConfig();
  assertConfig('Source', sourceDb);
  assertConfig('Target', targetDb);

  if (!args.execute) {
    console.log('Dry-run only. Add --execute to copy data.');
  }

  const source = await mysql.createConnection(sourceDb);
  const target = await mysql.createConnection(targetDb);
  try {
    const schemaPlan = await ensureTargetSchema(
      source,
      target,
      args.tables,
      args.execute,
    );
    const tables = schemaPlan.tables;
    if (!tables.length) {
      throw new Error('No project tables found on source database.');
    }
    await assertCompatibleColumns(
      source,
      target,
      tables.filter(
        (table) => args.execute || !schemaPlan.missingOnTarget.includes(table),
      ),
    );

    const plan = [];
    for (const table of tables) {
      const targetMissing = schemaPlan.missingOnTarget.includes(table);
      plan.push({
        table,
        sourceRows: await rowCount(source, table),
        targetRows: targetMissing && !args.execute ? '(missing)' : await rowCount(target, table),
      });
    }

    console.table(plan);
    const nonEmpty = plan.filter((item) => Number(item.targetRows) > 0);
    if (nonEmpty.length && !args.allowNonEmpty && !args.truncateTarget) {
      throw new Error(
        `Target has non-empty table(s): ${nonEmpty
          .map((item) => item.table)
          .join(', ')}. Use --truncate-target or --allow-non-empty.`,
      );
    }

    if (!args.execute) {
      return;
    }

    if (args.truncateTarget) {
      console.log('Deleting target table data before copy...');
      await truncateTargetTables(target, tables);
    }

    await target.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of tables) {
        const copied = await copyTable(source, target, table, true);
        console.log(`Copied ${copied} row(s): ${table}`);
      }
    } finally {
      await target.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const result = [];
    for (const table of tables) {
      result.push({ table, targetRows: await rowCount(target, table) });
    }
    console.table(result);
  } finally {
    await source.end();
    await target.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
