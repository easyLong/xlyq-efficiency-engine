import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import {
  HUITIANFU_COLUMNS,
  HUITIANFU_CUSTOMER_CODE,
  HUITIANFU_SQL,
  HUITIANFU_TEMPLATE_CODE,
} from './huitianfu-template';

type TemplateRecord = {
  id: string;
  customer_code: string;
  template_code: string;
  name: string;
  version: number;
  status: string;
  sql_text: string;
  columns_json: string;
};

type TemplateColumn = {
  key: string;
  label: string;
  width: number;
  numeric?: boolean;
};

export type SettlementFilters = {
  customerCode: string;
  startDate?: string;
  endDate?: string;
  businessPlatform?: string;
  businessCategory?: string;
  secondaryCategory?: string;
  tertiaryCategory?: string;
};

@Injectable()
export class SettlementService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  private queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params);
  }

  async onModuleInit() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS settlement_sql_templates (
        id CHAR(36) NOT NULL PRIMARY KEY,
        customer_code VARCHAR(32) NOT NULL,
        template_code VARCHAR(64) NOT NULL,
        name VARCHAR(128) NOT NULL,
        version INT NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'draft',
        sql_text LONGTEXT NOT NULL,
        columns_json TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_settlement_template_version (template_code, version),
        KEY idx_settlement_template_customer (customer_code, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    const existing = await this.queryRows<{ id: string }>(
      'SELECT id FROM settlement_sql_templates WHERE template_code = ? LIMIT 1',
      [HUITIANFU_TEMPLATE_CODE],
    );
    if (existing.length === 0) {
      await this.dataSource.query(
        `INSERT IGNORE INTO settlement_sql_templates
         (id, customer_code, template_code, name, version, status, sql_text, columns_json)
         VALUES (?, ?, ?, ?, 1, 'published', ?, ?)`,
        [
          randomUUID(),
          HUITIANFU_CUSTOMER_CODE,
          HUITIANFU_TEMPLATE_CODE,
          '汇添富结算明细',
          HUITIANFU_SQL,
          JSON.stringify(HUITIANFU_COLUMNS),
        ],
      );
    }
  }

  async listTemplates(customerCode: string) {
    if (!customerCode || customerCode === 'all') return [];
    const rows = await this.queryRows<TemplateRecord>(
      `SELECT id, customer_code, template_code, name, version
       FROM settlement_sql_templates
       WHERE customer_code = ? AND status = 'published'
       ORDER BY template_code, version DESC`,
      [customerCode],
    );
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.template_code)) return false;
      seen.add(row.template_code);
      return true;
    });
  }

  private async template(id: string, customerCode: string) {
    if (!id || !customerCode || customerCode === 'all') {
      throw new BadRequestException('请选择基金和结算模板');
    }
    const rows = await this.queryRows<TemplateRecord>(
      `SELECT * FROM settlement_sql_templates
       WHERE id = ? AND customer_code = ? AND status = 'published' LIMIT 1`,
      [id, customerCode],
    );
    const template = rows[0];
    if (!template) throw new NotFoundException('结算模板不存在或未发布');
    // Templates are deployed by trusted administrators, not accepted as request SQL.
    const sql = template.sql_text.trim();
    if (
      !/^SELECT\b/i.test(sql) ||
      /;|\bINTO\s+(OUTFILE|DUMPFILE)\b|\bFOR\s+UPDATE\b/i.test(sql)
    ) {
      throw new BadRequestException('结算模板必须是单条只读 SELECT');
    }
    const columns = JSON.parse(template.columns_json) as TemplateColumn[];
    if (
      !Array.isArray(columns) ||
      !columns.length ||
      columns.some(
        (column) => !/^[a-z][a-z0-9_]*$/.test(column.key) || !column.label,
      )
    ) {
      throw new BadRequestException('结算模板列配置无效');
    }
    return { ...template, sql, columns };
  }

  private filteredQuery(sql: string, filters: SettlementFilters) {
    const clauses = ['v.__customer_code = ?'];
    const params: unknown[] = [filters.customerCode];
    for (const [key, field] of [
      ['startDate', '__filter_date'],
      ['endDate', '__filter_date'],
    ] as const) {
      const value = filters[key];
      if (!value) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new BadRequestException('日期格式应为 YYYY-MM-DD');
      }
      clauses.push(`v.${field} ${key === 'startDate' ? '>=' : '<='} ?`);
      params.push(value);
    }
    for (const [key, field] of [
      ['businessPlatform', '__business_platform'],
      ['businessCategory', '__business_category'],
      ['secondaryCategory', '__secondary_category'],
      ['tertiaryCategory', '__tertiary_category'],
    ] as const) {
      const value = filters[key];
      if (!value || value === 'all') continue;
      clauses.push(`v.${field} = ?`);
      params.push(value);
    }
    return {
      from: `FROM (${sql}) AS v WHERE ${clauses.join(' AND ')}`,
      params,
    };
  }

  async preview(id: string, filters: SettlementFilters, page = 1) {
    const template = await this.template(id, filters.customerCode);
    const pageNumber = Math.max(1, Math.min(10000, Number(page) || 1));
    const { from, params } = this.filteredQuery(template.sql, filters);
    const [counts, result] = await Promise.all([
      this.queryRows<{ total: number | string }>(
        `SELECT COUNT(*) AS total ${from}`,
        params,
      ),
      this.queryRows<Record<string, unknown>>(
        `SELECT v.* ${from} ORDER BY v.__filter_date DESC, v.__task_id LIMIT ? OFFSET ?`,
        [...params, 100, (pageNumber - 1) * 100],
      ),
    ]);
    return {
      template: {
        id: template.id,
        name: template.name,
        version: template.version,
      },
      columns: template.columns,
      rows: this.publicRows(result, template.columns),
      total: Number(counts[0]?.total || 0),
      page: pageNumber,
      pageSize: 100,
    };
  }

  async exportExcel(id: string, filters: SettlementFilters) {
    const template = await this.template(id, filters.customerCode);
    const { from, params } = this.filteredQuery(template.sql, filters);
    const counts = await this.queryRows<{ total: number | string }>(
      `SELECT COUNT(*) AS total ${from}`,
      params,
    );
    const total = Number(counts[0]?.total || 0);
    if (total > 5000)
      throw new BadRequestException('单次导出最多 5000 条，请缩小时间范围');
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT v.* ${from} ORDER BY v.__filter_date DESC, v.__task_id LIMIT 5000`,
      params,
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('结算明细');
    sheet.columns = template.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: column.width || 18,
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { vertical: 'middle' };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = {
      from: 'A1',
      to: { row: 1, column: template.columns.length },
    };
    for (const row of this.publicRows(rows, template.columns)) {
      sheet.addRow(
        Object.fromEntries(
          template.columns.map((column) => [
            column.key,
            column.numeric && row[column.key] !== null && row[column.key] !== ''
              ? Number(row[column.key])
              : row[column.key],
          ]),
        ),
      );
    }
    for (const [index, column] of template.columns.entries()) {
      if (column.numeric)
        sheet.getColumn(index + 1).numFmt =
          column.key === 'quantity' ? '0' : '#,##0.00';
    }
    const raw = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const datePart =
      [filters.startDate, filters.endDate].filter(Boolean).join('_') ||
      '全部时间';
    const fileName =
      `${template.name}_v${template.version}_${datePart}.xlsx`.replace(
        /[\\/:*?"<>|]/g,
        '_',
      );
    return { buffer, fileName, total };
  }

  private publicRows(
    rows: Record<string, unknown>[],
    columns: TemplateColumn[],
  ) {
    return rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [column.key, row[column.key] ?? null]),
      ),
    );
  }
}
