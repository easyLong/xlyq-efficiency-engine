import { QuotationsService } from './quotations.service';

describe('QuotationsService CSV parser', () => {
  const service = new QuotationsService(
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );

  it('keeps CSV remark columns out of quotation item titles', () => {
    const csv = [
      '类目,项目,业务类型,交付类型,内容说明,单位,价格（含税）,备注说明',
      '运营支持,线上银行平台日常运营,运营支持,线上银行平台,"包含文章banner上传、权益配置及FAQ",月,13000,"日常运营支持项是指：每月不超过180人工时"',
      '文案,原创文案,纯文案,纯文案,"每篇500-1200字",篇,2000,"一般包括行业资讯"',
      '设计,长图设计,设计,长图新设计,"长图首屏+延展页",页,800,"备注里的页不能作为子项"',
    ].join('\n');

    const parsed = (
      service as unknown as {
        parseQuotationCsvText: (
          rawContent: string,
          fileName?: string,
        ) => {
          items: Array<{
            itemName: string;
            unit: string;
            unitPrice: number;
            remark: string;
          }>;
        };
      }
    ).parseQuotationCsvText(csv, '创金报价清单.csv');

    expect(parsed.items).toHaveLength(3);
    expect(parsed.items[0].itemName).toBe(
      '运营支持 > 线上银行平台日常运营 > 运营支持 > 线上银行平台',
    );
    expect(parsed.items[0].remark).toContain(
      '子项详情：包含文章banner上传、权益配置及FAQ',
    );
    expect(parsed.items[0].itemName).not.toContain('日常运营支持项');
    expect(parsed.items[0].unit).toBe('月');
    expect(parsed.items[0].unitPrice).toBe(13000);
    expect(parsed.items[0].remark).toContain('备注：日常运营支持项');
    expect(parsed.items[2].itemName).toBe(
      '设计 > 长图设计 > 设计 > 长图新设计',
    );
    expect(parsed.items[2].remark).toContain('子项详情：长图首屏+延展页');
    expect(parsed.items[2].itemName).not.toContain('备注里的页');
    expect(parsed.items[2].unit).toBe('页');
  });
});
