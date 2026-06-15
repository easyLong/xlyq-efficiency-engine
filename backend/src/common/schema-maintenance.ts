import { DataSource } from 'typeorm';

function quoteIdentifier(value: string) {
  return `\`${value.replace(/`/g, '``')}\``;
}

export async function ensureIndex(
  dataSource: DataSource,
  tableName: string,
  indexName: string,
  columns: string[],
) {
  const tableRows = await dataSource.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
    `,
    [tableName],
  );
  if (Number(tableRows?.[0]?.count ?? 0) === 0) {
    return;
  }
  const rows = await dataSource.query(
    `
      SELECT COUNT(*) AS count
      FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND index_name = ?
    `,
    [tableName, indexName],
  );
  if (Number(rows?.[0]?.count ?? 0) > 0) {
    return;
  }
  const columnSql = columns.map(quoteIdentifier).join(', ');
  await dataSource.query(
    `CREATE INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(
      tableName,
    )} (${columnSql})`,
  );
}
