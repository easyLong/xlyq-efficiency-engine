import ExcelJS from 'exceljs';
import { DataSource } from 'typeorm';
import { SettlementService } from './settlement.service';

describe('SettlementService', () => {
  const template = {
    id: 'template-1',
    customer_code: 'China Universal',
    template_code: 'china_universal',
    name: '汇添富结算明细',
    version: 1,
    status: 'published',
    sql_text: 'SELECT 1 AS __task_id, 1 AS __customer_code',
    columns_json: JSON.stringify([
      { key: 'unit_price', label: '单价', width: 16, numeric: true },
      { key: 'quantity', label: '数量', width: 12, numeric: true },
      { key: 'total_price', label: '总价', width: 16, numeric: true },
    ]),
  };

  function fixture() {
    const query = jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM settlement_sql_templates'))
        return [template];
      if (sql.includes('COUNT(*)')) return [{ total: 1 }];
      if (sql.includes('SELECT v.*')) {
        return [
          {
            __task_id: 'task-1',
            unit_price: '20.00',
            quantity: 3,
            total_price: '20.00',
          },
        ];
      }
      return [];
    });
    const service = new SettlementService({ query } as unknown as DataSource);
    return { service, query };
  }

  it('applies customer and date filters to the preview without changing task prices', async () => {
    const { service, query } = fixture();
    const result = await service.preview('template-1', {
      customerCode: 'China Universal',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(result.total).toBe(1);
    expect(result.rows[0]).toEqual({
      unit_price: '20.00',
      quantity: 3,
      total_price: '20.00',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('v.__filter_date >= ? AND v.__filter_date <= ?'),
      ['China Universal', '2026-09-01', '2026-09-30'],
    );
  });

  it('exports the same column order and numeric values to a real xlsx file', async () => {
    const { service } = fixture();
    const result = await service.exportExcel('template-1', {
      customerCode: 'China Universal',
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const sheet = workbook.getWorksheet('结算明细')!;
    expect([1, 2, 3].map((col) => sheet.getRow(1).getCell(col).value)).toEqual([
      '单价',
      '数量',
      '总价',
    ]);
    expect([1, 2, 3].map((col) => sheet.getRow(2).getCell(col).value)).toEqual([
      20, 3, 20,
    ]);
  });
});
