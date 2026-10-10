import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
import {
  DEFAULT_SETTLEMENT_CUSTOMER_CODE,
  DEFAULT_SETTLEMENT_TEMPLATE_CODE,
  DEFAULT_SETTLEMENT_TEMPLATE_NAME,
  DEFAULT_SETTLEMENT_TEMPLATE_VERSION,
  DEFAULT_SETTLEMENT_COLUMNS,
  DEFAULT_SETTLEMENT_SQL,
  HUITIANFU_COLUMNS,
  HUITIANFU_CUSTOMER_CODE,
  HUITIANFU_SQL,
  HUITIANFU_TEMPLATE_CODE,
  HUITIANFU_TEMPLATE_VERSION,
  HUAXIA_SETTLEMENT_COLUMNS,
  HUAXIA_SETTLEMENT_CUSTOMER_CODE,
  HUAXIA_SETTLEMENT_TEMPLATE_CODE,
  HUAXIA_SETTLEMENT_TEMPLATE_VERSION,
  XINGZHENG_SETTLEMENT_COLUMNS,
  XINGZHENG_SETTLEMENT_CUSTOMER_CODE,
  XINGZHENG_SETTLEMENT_TEMPLATE_CODE,
  XINGZHENG_SETTLEMENT_TEMPLATE_VERSION,
  HAITONG_FUHAI_SETTLEMENT_COLUMNS,
  HAITONG_FUHAI_SETTLEMENT_CUSTOMER_CODE,
  HAITONG_FUHAI_SETTLEMENT_TEMPLATE_CODE,
  HAITONG_FUHAI_SETTLEMENT_TEMPLATE_VERSION,
  CHANGSHENG_SETTLEMENT_COLUMNS,
  CHANGSHENG_SETTLEMENT_CUSTOMER_CODE,
  CHANGSHENG_SETTLEMENT_TEMPLATE_CODE,
  CHANGSHENG_SETTLEMENT_TEMPLATE_VERSION,
  CICC_SETTLEMENT_COLUMNS,
  CICC_SETTLEMENT_CUSTOMER_CODE,
  CICC_SETTLEMENT_TEMPLATE_CODE,
  CICC_SETTLEMENT_TEMPLATE_VERSION,
  EFUND_SETTLEMENT_COLUMNS,
  EFUND_SETTLEMENT_CUSTOMER_CODE,
  EFUND_SETTLEMENT_TEMPLATE_CODE,
  EFUND_SETTLEMENT_TEMPLATE_VERSION,
} from './huitianfu-template';
import { HUAXIA_SETTLEMENT_SQL } from './huaxia-template';
import { XINGZHENG_SETTLEMENT_SQL } from './xingzheng-template';
import { HAITONG_FUHAI_SETTLEMENT_SQL } from './haitong-fuhai-template';
import { CHANGSHENG_SETTLEMENT_SQL } from './changsheng-template';
import { CICC_SETTLEMENT_SQL } from './cicc-template';
import { EFUND_SETTLEMENT_SQL } from './efund-template';

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
  percent?: boolean;
  image?: boolean;
  mergeBy?: string;
  headerWrap?: boolean;
  headerHeight?: number;
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
    await this.ensureBuiltInTemplate({
      customerCode: HUITIANFU_CUSTOMER_CODE,
      templateCode: HUITIANFU_TEMPLATE_CODE,
      name: '汇添富结算明细',
      version: HUITIANFU_TEMPLATE_VERSION,
      sql: HUITIANFU_SQL,
      columns: HUITIANFU_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: DEFAULT_SETTLEMENT_CUSTOMER_CODE,
      templateCode: DEFAULT_SETTLEMENT_TEMPLATE_CODE,
      name: DEFAULT_SETTLEMENT_TEMPLATE_NAME,
      version: DEFAULT_SETTLEMENT_TEMPLATE_VERSION,
      sql: DEFAULT_SETTLEMENT_SQL,
      columns: DEFAULT_SETTLEMENT_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: HUAXIA_SETTLEMENT_CUSTOMER_CODE,
      templateCode: HUAXIA_SETTLEMENT_TEMPLATE_CODE,
      name: '华夏结算明细',
      version: HUAXIA_SETTLEMENT_TEMPLATE_VERSION,
      sql: HUAXIA_SETTLEMENT_SQL,
      columns: HUAXIA_SETTLEMENT_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: XINGZHENG_SETTLEMENT_CUSTOMER_CODE,
      templateCode: XINGZHENG_SETTLEMENT_TEMPLATE_CODE,
      name: '兴全结算明细',
      version: XINGZHENG_SETTLEMENT_TEMPLATE_VERSION,
      sql: XINGZHENG_SETTLEMENT_SQL,
      columns: XINGZHENG_SETTLEMENT_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: HAITONG_FUHAI_SETTLEMENT_CUSTOMER_CODE,
      templateCode: HAITONG_FUHAI_SETTLEMENT_TEMPLATE_CODE,
      name: '海富通结算明细',
      version: HAITONG_FUHAI_SETTLEMENT_TEMPLATE_VERSION,
      sql: HAITONG_FUHAI_SETTLEMENT_SQL,
      columns: HAITONG_FUHAI_SETTLEMENT_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: CHANGSHENG_SETTLEMENT_CUSTOMER_CODE,
      templateCode: CHANGSHENG_SETTLEMENT_TEMPLATE_CODE,
      name: '长盛结算明细',
      version: CHANGSHENG_SETTLEMENT_TEMPLATE_VERSION,
      sql: CHANGSHENG_SETTLEMENT_SQL,
      columns: CHANGSHENG_SETTLEMENT_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: CICC_SETTLEMENT_CUSTOMER_CODE,
      templateCode: CICC_SETTLEMENT_TEMPLATE_CODE,
      name: '中金结算明细',
      version: CICC_SETTLEMENT_TEMPLATE_VERSION,
      sql: CICC_SETTLEMENT_SQL,
      columns: CICC_SETTLEMENT_COLUMNS,
    });
    await this.ensureBuiltInTemplate({
      customerCode: EFUND_SETTLEMENT_CUSTOMER_CODE,
      templateCode: EFUND_SETTLEMENT_TEMPLATE_CODE,
      name: '易方达结算明细',
      version: EFUND_SETTLEMENT_TEMPLATE_VERSION,
      sql: EFUND_SETTLEMENT_SQL,
      columns: EFUND_SETTLEMENT_COLUMNS,
    });
  }

  private async ensureBuiltInTemplate(input: {
    customerCode: string;
    templateCode: string;
    name: string;
    version: number;
    sql: string;
    columns: readonly unknown[];
  }) {
    const existing = await this.queryRows<{ id: string; version: number }>(
      'SELECT id, version FROM settlement_sql_templates WHERE template_code = ? ORDER BY version DESC LIMIT 1',
      [input.templateCode],
    );
    if (existing.length === 0) {
      await this.dataSource.query(
        `INSERT IGNORE INTO settlement_sql_templates
         (id, customer_code, template_code, name, version, status, sql_text, columns_json)
         VALUES (?, ?, ?, ?, ?, 'published', ?, ?)`,
        [
          randomUUID(),
          input.customerCode,
          input.templateCode,
          input.name,
          input.version,
          input.sql,
          JSON.stringify(input.columns),
        ],
      );
    } else if (Number(existing[0].version) < input.version) {
      // Preserve the previous SQL for rollback and publish the new version
      // atomically so a failed insert does not leave the fund without a template.
      await this.dataSource.transaction(async (manager) => {
        await manager.query(
          `UPDATE settlement_sql_templates SET status = 'archived'
           WHERE template_code = ? AND status = 'published'`,
          [input.templateCode],
        );
        await manager.query(
          `INSERT INTO settlement_sql_templates
           (id, customer_code, template_code, name, version, status, sql_text, columns_json)
           VALUES (?, ?, ?, ?, ?, 'published', ?, ?)`,
          [
            randomUUID(),
            input.customerCode,
            input.templateCode,
            input.name,
            input.version,
            input.sql,
            JSON.stringify(input.columns),
          ],
        );
      });
    }
  }

  async listTemplates(customerCode: string) {
    if (!customerCode) return [];
    const rows = await this.queryRows<TemplateRecord>(
      `SELECT id, customer_code, template_code, name, version
       FROM settlement_sql_templates
       WHERE status = 'published' AND (customer_code = ? OR customer_code = ?)
       ORDER BY (customer_code = ?) DESC, (customer_code = '*') DESC, template_code, version DESC`,
      [customerCode, DEFAULT_SETTLEMENT_CUSTOMER_CODE, customerCode],
    );
    const seen = new Set<string>();
    const visibleRows = rows.filter((row) => {
      if (seen.has(row.template_code)) return false;
      seen.add(row.template_code);
      return true;
    });
    // Keep the fallback relationship explicit so callers never need to infer it
    // from SQL ordering when selecting the effective template.
    return visibleRows.map((row) => ({
      ...row,
      is_fallback:
        customerCode !== 'all' &&
        row.customer_code === DEFAULT_SETTLEMENT_CUSTOMER_CODE,
    }));
  }

  private async template(id: string, customerCode: string) {
    if (!id || !customerCode) {
      throw new BadRequestException('请选择基金和结算模板');
    }
    const rows = await this.queryRows<TemplateRecord>(
      `SELECT * FROM settlement_sql_templates
       WHERE id = ? AND status = 'published'
         AND (customer_code = ? OR customer_code = ?)
       ORDER BY (customer_code = ?) DESC, (customer_code = '*') DESC
       LIMIT 1`,
      [id, customerCode, DEFAULT_SETTLEMENT_CUSTOMER_CODE, customerCode],
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
    const clauses: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (filters.customerCode !== 'all') {
      clauses.push('v.__customer_code = ?');
      params.push(filters.customerCode);
    }
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

  private settlementOrder(template: Pick<TemplateRecord, 'template_code'>) {
    return template.template_code === EFUND_SETTLEMENT_TEMPLATE_CODE
      ? 'v.__efund_contact_group, v.__efund_assignee_group, v.__filter_date DESC, v.__task_id'
      : 'v.__filter_date DESC, v.__task_id';
  }

  async preview(id: string, filters: SettlementFilters, page = 1) {
    const template = await this.template(id, filters.customerCode);
    const pageNumber = Math.max(1, Math.min(10000, Number(page) || 1));
    const { from, params } = this.filteredQuery(template.sql, filters);
    const orderBy = this.settlementOrder(template);
    const [counts, result] = await Promise.all([
      this.queryRows<{ total: number | string }>(
        `SELECT COUNT(*) AS total ${from}`,
        params,
      ),
      this.queryRows<Record<string, unknown>>(
        `SELECT v.* ${from} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
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
    const orderBy = this.settlementOrder(template);
    const counts = await this.queryRows<{ total: number | string }>(
      `SELECT COUNT(*) AS total ${from}`,
      params,
    );
    const total = Number(counts[0]?.total || 0);
    if (total > 5000)
      throw new BadRequestException('单次导出最多 5000 条，请缩小时间范围');
    const rows = await this.queryRows<Record<string, unknown>>(
      `SELECT v.* ${from} ORDER BY ${orderBy} LIMIT 5000`,
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
    const headerHeight = Math.max(
      0,
      ...template.columns.map((column) => column.headerHeight ?? 0),
    );
    if (headerHeight) sheet.getRow(1).height = headerHeight;
    for (const [index, column] of template.columns.entries()) {
      if (column.headerWrap) {
        sheet.getCell(1, index + 1).alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
      }
    }
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
      if (!column.mergeBy) continue;
      let start = 0;
      while (start < rows.length) {
        const groupValue = rows[start][column.mergeBy];
        if (groupValue === null || groupValue === undefined) {
          start += 1;
          continue;
        }
        let end = start + 1;
        while (end < rows.length && rows[end][column.mergeBy] === groupValue)
          end += 1;
        if (end - start > 1) {
          sheet.mergeCells(start + 2, index + 1, end + 1, index + 1);
          sheet.getCell(start + 2, index + 1).alignment = {
            vertical: 'middle',
            horizontal: 'center',
          };
        }
        start = end;
      }
    }
    for (const [index, column] of template.columns.entries()) {
      if (column.numeric)
        sheet.getColumn(index + 1).numFmt = column.percent
          ? '0%'
          : column.key === 'quantity'
            ? '0'
            : '#,##0.00';
    }
    const imageColumn = template.columns.findIndex((column) => column.image);
    if (imageColumn >= 0) {
      const imageTemplateColumn = template.columns[imageColumn];
      for (const [rowIndex, row] of rows.entries()) {
        const imageUrls = String(row[imageTemplateColumn.key] ?? '')
          .split(/\r?\n|\\n/)
          .map((url) => url.trim())
          .filter(Boolean)
          .slice(0, 2);
        let embedded = 0;
        for (const [imageIndex, imageUrl] of imageUrls.entries()) {
          const image = await this.localExportImage(imageUrl);
          if (!image) continue;
          const imageId = workbook.addImage({
            base64: `data:image/${image.extension};base64,${image.buffer.toString('base64')}`,
            extension: image.extension,
          });
          const excelRow = rowIndex + 2;
          sheet.addImage(imageId, {
            tl: {
              col: imageColumn + imageIndex * 0.3,
              row: excelRow - 1 + 0.1,
            },
            ext: { width: 48, height: 42 },
          });
          embedded += 1;
        }
        if (embedded) {
          sheet.getRow(rowIndex + 2).height = 36;
          sheet.getCell(rowIndex + 2, imageColumn + 1).value = null;
        }
      }
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

  private async localExportImage(fileUrl: string) {
    if (!fileUrl.startsWith('/uploads/task-assets/')) return null;
    const publicDir = resolve(process.cwd(), 'public');
    const localPath = resolve(
      publicDir,
      fileUrl.split(/[?#]/)[0].replace(/^\/+/, ''),
    );
    if (
      localPath === publicDir ||
      !localPath.startsWith(`${publicDir}${sep}`)
    ) {
      return null;
    }
    const extension = extname(localPath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(extension)) return null;
    try {
      return {
        buffer: await readFile(localPath),
        extension:
          extension === '.jpg'
            ? 'jpeg'
            : (extension.slice(1) as 'png' | 'jpeg'),
      };
    } catch {
      return null;
    }
  }
}
