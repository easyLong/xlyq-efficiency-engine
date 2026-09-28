import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { UpdateDimensionDictionaryDto } from './dto/update-dimension-dictionary.dto';
import { UpsertDimensionDictionaryDto } from './dto/upsert-dimension-dictionary.dto';
import { BusinessCategorySecondaryCategoryEntity } from './entities/business-category-secondary-category.entity';
import { DimensionDictionaryEntity } from './entities/dimension-dictionary.entity';
import { TaskPriceRuleEntity } from './entities/task-price-rule.entity';
import { CreateTaskPriceRuleDto } from './dto/create-task-price-rule.dto';
import { UpdateTaskPriceRuleDto } from './dto/update-task-price-rule.dto';

type SeedDimension = {
  dimensionType: string;
  dimensionCode: string;
  dimensionName: string;
  productType?: string | null;
  parentCode?: string | null;
  sortOrder?: number;
  estimatedHours?: string | null;
  contributionPoints?: string | null;
  productCode?: string | null;
  standardVersion?: string | null;
  measureUnit?: string | null;
  contentScope?: string | null;
  deliveryStandard?: string | null;
  scoringBoundary?: string | null;
  acceptanceEvidence?: string | null;
  referenceMinutes?: number | null;
  scoreMode?: string | null;
  scoreRate?: string | null;
};

@Injectable()
export class DimensionsService implements OnModuleInit {
  constructor(
    @InjectRepository(DimensionDictionaryEntity)
    private readonly dimensionsRepository: Repository<DimensionDictionaryEntity>,
    @InjectRepository(BusinessCategorySecondaryCategoryEntity)
    private readonly businessCategorySecondaryRepository: Repository<BusinessCategorySecondaryCategoryEntity>,
    @InjectRepository(TaskPriceRuleEntity)
    private readonly taskPriceRulesRepository: Repository<TaskPriceRuleEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureTable();
    await this.ensureMetricColumns();
    await this.ensureTaskPriceRulesTable();
    await this.ensureBusinessCategorySecondaryTable();
    await this.seedDefaults();
    await this.seedBusinessCategorySecondaryRelations();
    await this.syncContentStandardV2();
    await this.seedCompatibilityTertiaryCategories();
  }

  async findAll(input?: {
    dimensionType?: string;
    parentCode?: string;
    status?: string;
  }) {
    const where = {
      ...(input?.dimensionType ? { dimension_type: input.dimensionType } : {}),
      ...(input?.parentCode ? { parent_code: input.parentCode } : {}),
      ...(input?.status ? { status: input.status } : {}),
    };
    return this.dimensionsRepository.find({
      where,
      order: {
        dimension_type: 'ASC',
        sort_order: 'ASC',
        dimension_name: 'ASC',
      },
    });
  }

  async grouped() {
    const rows = await this.findAll({ status: 'active' });
    return rows.reduce<Record<string, DimensionDictionaryEntity[]>>(
      (acc, item) => {
        acc[item.dimension_type] ??= [];
        acc[item.dimension_type].push(item);
        return acc;
      },
      {},
    );
  }

  async findBusinessCategorySecondaryRelations(status = 'active') {
    return this.businessCategorySecondaryRepository.find({
      where: status && status !== 'all' ? { status } : {},
      order: {
        category_sort_order: 'ASC',
        secondary_sort_order: 'ASC',
        business_category_name: 'ASC',
        secondary_category_name: 'ASC',
      },
    });
  }

  async upsert(dto: UpsertDimensionDictionaryDto) {
    const existing = await this.dimensionsRepository.findOne({
      where: {
        dimension_type: dto.dimensionType,
        dimension_code: dto.dimensionCode,
      },
    });
    const entity =
      existing ??
      this.dimensionsRepository.create({
        dimension_type: dto.dimensionType,
        dimension_code: dto.dimensionCode,
      });
    Object.assign(entity, {
      dimension_name: dto.dimensionName,
      product_type:
        dto.productType !== undefined
          ? dto.productType
          : (entity.product_type ?? null),
      parent_code: dto.parentCode ?? null,
      sort_order: dto.sortOrder ?? entity.sort_order ?? 100,
      status: dto.status ?? entity.status ?? 'active',
      remark: dto.remark ?? entity.remark ?? null,
      product_code:
        dto.productCode !== undefined
          ? dto.productCode
          : (entity.product_code ?? null),
      standard_version:
        dto.standardVersion !== undefined
          ? dto.standardVersion
          : (entity.standard_version ?? null),
      estimated_hours:
        dto.estimatedHours !== undefined
          ? dto.estimatedHours
          : (entity.estimated_hours ?? null),
      contribution_points:
        dto.contributionPoints !== undefined
          ? dto.contributionPoints
          : (entity.contribution_points ?? null),
      measure_unit:
        dto.measureUnit !== undefined
          ? dto.measureUnit
          : (entity.measure_unit ?? null),
      content_scope:
        dto.contentScope !== undefined
          ? dto.contentScope
          : (entity.content_scope ?? null),
      delivery_standard:
        dto.deliveryStandard !== undefined
          ? dto.deliveryStandard
          : (entity.delivery_standard ?? null),
      scoring_boundary:
        dto.scoringBoundary !== undefined
          ? dto.scoringBoundary
          : (entity.scoring_boundary ?? null),
      acceptance_evidence:
        dto.acceptanceEvidence !== undefined
          ? dto.acceptanceEvidence
          : (entity.acceptance_evidence ?? null),
      score_mode:
        dto.scoreMode !== undefined
          ? dto.scoreMode
          : (entity.score_mode ?? null),
      score_rate:
        dto.scoreRate !== undefined
          ? dto.scoreRate
          : (entity.score_rate ?? null),
      reference_minutes:
        dto.referenceMinutes !== undefined
          ? dto.referenceMinutes
          : (entity.reference_minutes ?? null),
    });
    return this.dimensionsRepository.save(entity);
  }

  async update(id: string, dto: UpdateDimensionDictionaryDto) {
    const entity = await this.dimensionsRepository.findOne({ where: { id } });
    if (!entity) {
      throw new NotFoundException('Dimension dictionary item not found');
    }
    Object.assign(entity, {
      dimension_type: dto.dimensionType ?? entity.dimension_type,
      dimension_code: dto.dimensionCode ?? entity.dimension_code,
      dimension_name: dto.dimensionName ?? entity.dimension_name,
      product_type:
        dto.productType !== undefined ? dto.productType : entity.product_type,
      parent_code:
        dto.parentCode !== undefined ? dto.parentCode : entity.parent_code,
      sort_order: dto.sortOrder ?? entity.sort_order,
      status: dto.status ?? entity.status,
      remark: dto.remark !== undefined ? dto.remark : entity.remark,
      product_code:
        dto.productCode !== undefined ? dto.productCode : entity.product_code,
      standard_version:
        dto.standardVersion !== undefined
          ? dto.standardVersion
          : entity.standard_version,
      estimated_hours:
        dto.estimatedHours !== undefined
          ? dto.estimatedHours
          : entity.estimated_hours,
      contribution_points:
        dto.contributionPoints !== undefined
          ? dto.contributionPoints
          : entity.contribution_points,
      measure_unit:
        dto.measureUnit !== undefined ? dto.measureUnit : entity.measure_unit,
      content_scope:
        dto.contentScope !== undefined
          ? dto.contentScope
          : entity.content_scope,
      delivery_standard:
        dto.deliveryStandard !== undefined
          ? dto.deliveryStandard
          : entity.delivery_standard,
      scoring_boundary:
        dto.scoringBoundary !== undefined
          ? dto.scoringBoundary
          : entity.scoring_boundary,
      acceptance_evidence:
        dto.acceptanceEvidence !== undefined
          ? dto.acceptanceEvidence
          : entity.acceptance_evidence,
      score_mode:
        dto.scoreMode !== undefined ? dto.scoreMode : entity.score_mode,
      score_rate:
        dto.scoreRate !== undefined ? dto.scoreRate : entity.score_rate,
      reference_minutes:
        dto.referenceMinutes !== undefined
          ? dto.referenceMinutes
          : entity.reference_minutes,
    });
    return this.dimensionsRepository.save(entity);
  }

  async categoryTree() {
    const [categories, secondaries, tertiaries] = await Promise.all([
      this.findAll({ dimensionType: 'business_category', status: 'active' }),
      this.findAll({ dimensionType: 'secondary_category', status: 'active' }),
      this.findAll({ dimensionType: 'tertiary_category', status: 'active' }),
    ]);
    return categories.map((category) => ({
      code: category.dimension_code,
      name: category.dimension_name,
      secondaries: secondaries
        .filter((item) => item.parent_code === category.dimension_code)
        .map((secondary) => ({
          code: secondary.dimension_code,
          name: secondary.dimension_name,
          tertiaries: tertiaries
            .filter((item) => item.parent_code === secondary.dimension_code)
            .map((tertiary) => ({
              code: tertiary.dimension_code,
              name: tertiary.dimension_name,
              productType: tertiary.product_type,
              productCode: tertiary.product_code,
              standardVersion: tertiary.standard_version,
              estimatedHours: tertiary.estimated_hours ?? '0.00',
              contributionPoints: tertiary.contribution_points ?? '0.00',
              measureUnit: tertiary.measure_unit,
              contentScope: tertiary.content_scope,
              deliveryStandard: tertiary.delivery_standard,
              scoringBoundary: tertiary.scoring_boundary,
              acceptanceEvidence: tertiary.acceptance_evidence,
              referenceMinutes: tertiary.reference_minutes,
              scoreMode: tertiary.score_mode,
              scoreRate: tertiary.score_rate,
              sortOrder: tertiary.sort_order,
              remark: tertiary.remark,
            })),
        })),
    }));
  }

  async findTaskPriceRules(input?: { customerCode?: string; status?: string }) {
    return this.taskPriceRulesRepository.find({
      where: {
        ...(input?.customerCode && input.customerCode !== 'all'
          ? { customer_code: input.customerCode }
          : {}),
        ...(input?.status && input.status !== 'all'
          ? { status: input.status }
          : {}),
      },
      order: {
        customer_code: 'ASC',
        business_category_code: 'ASC',
        secondary_category_code: 'ASC',
        tertiary_category_code: 'ASC',
        effective_from: 'DESC',
      },
    });
  }

  async createTaskPriceRule(dto: CreateTaskPriceRuleDto) {
    await this.assertTaskPriceRulePeriod(dto);
    return this.taskPriceRulesRepository.save(
      this.taskPriceRulesRepository.create({
        customer_code: dto.customerCode,
        business_category_code: dto.businessCategoryCode,
        secondary_category_code: dto.secondaryCategoryCode,
        tertiary_category_code: dto.tertiaryCategoryCode,
        pricing_mode: dto.pricingMode ?? 'fixed',
        unit_price: dto.unitPrice,
        effective_from: dto.effectiveFrom || null,
        effective_to: dto.effectiveTo || null,
        version_no: dto.versionNo ?? 1,
        status: dto.status ?? 'active',
        remark: dto.remark ?? null,
      }),
    );
  }

  async updateTaskPriceRule(id: string, dto: UpdateTaskPriceRuleDto) {
    const entity = await this.taskPriceRulesRepository.findOne({ where: { id } });
    if (!entity) throw new NotFoundException('Task price rule not found');
    const next = {
      customerCode: dto.customerCode ?? entity.customer_code,
      businessCategoryCode:
        dto.businessCategoryCode ?? entity.business_category_code,
      secondaryCategoryCode:
        dto.secondaryCategoryCode ?? entity.secondary_category_code,
      tertiaryCategoryCode:
        dto.tertiaryCategoryCode ?? entity.tertiary_category_code,
      pricingMode: dto.pricingMode ?? entity.pricing_mode,
      unitPrice: dto.unitPrice ?? entity.unit_price,
      effectiveFrom:
        dto.effectiveFrom !== undefined
          ? dto.effectiveFrom
          : entity.effective_from,
      effectiveTo:
        dto.effectiveTo !== undefined ? dto.effectiveTo : entity.effective_to,
      versionNo: dto.versionNo ?? entity.version_no,
      status: dto.status ?? entity.status,
      remark: dto.remark !== undefined ? dto.remark : entity.remark,
    };
    const materialChanged =
      entity.status === 'active' &&
      (next.customerCode !== entity.customer_code ||
        next.businessCategoryCode !== entity.business_category_code ||
        next.secondaryCategoryCode !== entity.secondary_category_code ||
        next.tertiaryCategoryCode !== entity.tertiary_category_code ||
        next.pricingMode !== entity.pricing_mode ||
        String(next.unitPrice) !== String(entity.unit_price) ||
        next.effectiveFrom !== entity.effective_from ||
        next.effectiveTo !== entity.effective_to);
    if (materialChanged) {
      await this.assertTaskPriceRulePeriod(next, id);
      entity.status = 'inactive';
      await this.taskPriceRulesRepository.save(entity);
      return this.createTaskPriceRule({
        customerCode: next.customerCode,
        businessCategoryCode: next.businessCategoryCode,
        secondaryCategoryCode: next.secondaryCategoryCode,
        tertiaryCategoryCode: next.tertiaryCategoryCode,
        pricingMode: next.pricingMode,
        unitPrice: String(next.unitPrice),
        effectiveFrom: next.effectiveFrom,
        effectiveTo: next.effectiveTo,
        versionNo: Math.max(entity.version_no + 1, next.versionNo),
        status: next.status,
        remark: next.remark,
      });
    }
    await this.assertTaskPriceRulePeriod(
      {
        customerCode: next.customerCode,
        businessCategoryCode: next.businessCategoryCode,
        secondaryCategoryCode: next.secondaryCategoryCode,
        tertiaryCategoryCode: next.tertiaryCategoryCode,
        effectiveFrom: next.effectiveFrom,
        effectiveTo: next.effectiveTo,
        status: next.status,
      },
      id,
    );
    Object.assign(entity, {
      customer_code: next.customerCode,
      business_category_code: next.businessCategoryCode,
      secondary_category_code: next.secondaryCategoryCode,
      tertiary_category_code: next.tertiaryCategoryCode,
      pricing_mode: next.pricingMode,
      unit_price: next.unitPrice,
      effective_from:
        next.effectiveFrom || null,
      effective_to:
        next.effectiveTo || null,
      version_no: next.versionNo,
      status: next.status,
      remark: next.remark || null,
    });
    return this.taskPriceRulesRepository.save(entity);
  }

  async resolveTaskPrice(input: {
    customerCode: string;
    businessCategory?: string | null;
    secondaryCategory?: string | null;
    tertiaryCodes: string[];
    quantities?: Record<string, number>;
    effectiveAt?: string | null;
  }) {
    const categoryCode = this.slug(String(input.businessCategory ?? '').trim());
    const secondaryValue = String(input.secondaryCategory ?? '').trim();
    const secondary = await this.dimensionsRepository.findOne({
      where: [
        {
          dimension_type: 'secondary_category',
          dimension_code: secondaryValue,
          parent_code: categoryCode,
          status: 'active',
        },
        {
          dimension_type: 'secondary_category',
          dimension_name: secondaryValue,
          parent_code: categoryCode,
          status: 'active',
        },
      ],
    });
    const secondaryCode = secondary?.dimension_code ?? secondaryValue;
    const rules = await this.taskPriceRulesRepository.find({
      where: {
        customer_code: In([input.customerCode, '*']),
        business_category_code: categoryCode,
        secondary_category_code: secondaryCode,
        status: 'active',
      },
      order: { version_no: 'DESC', effective_from: 'DESC' },
    });
    const effectiveDate = input.effectiveAt
      ? new Date(input.effectiveAt)
      : new Date();
    const applicable = rules.filter((rule) => {
      const from = rule.effective_from ? new Date(rule.effective_from) : null;
      const to = rule.effective_to ? new Date(rule.effective_to) : null;
      return (!from || effectiveDate >= from) && (!to || effectiveDate <= to);
    });
    const breakdown = input.tertiaryCodes.map((code) => {
      const candidates = applicable
        .filter((rule) => rule.tertiary_category_code === code)
        .sort((left, right) => {
          const customerOrder = (right.customer_code === input.customerCode ? 1 : 0) - (left.customer_code === input.customerCode ? 1 : 0);
          return customerOrder || right.version_no - left.version_no;
        });
      const rule = candidates[0] ?? null;
      const quantity = Number(input.quantities?.[code] ?? 1);
      const amount = rule
        ? (rule.pricing_mode === 'time_rate'
            ? quantity * Number(rule.unit_price) / 60
            : quantity * Number(rule.unit_price))
        : 0;
      return {
        tertiaryCode: code,
        quantity,
        unitPrice: rule?.unit_price ?? null,
        amount: amount.toFixed(2),
        ruleId: rule?.id ?? null,
        ruleVersion: rule?.version_no ?? null,
      };
    });
    const missingCodes = breakdown.filter((item) => !item.ruleId).map((item) => item.tertiaryCode);
    return {
      totalAmount: breakdown.reduce((sum, item) => sum + Number(item.amount), 0).toFixed(2),
      breakdown,
      missingCodes,
      source: missingCodes.length ? 'missing_rule' : 'standard_rule',
    };
  }

  private async assertTaskPriceRulePeriod(
    input: {
      customerCode: string;
      businessCategoryCode: string;
      secondaryCategoryCode: string;
      tertiaryCategoryCode: string;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      status?: string;
    },
    excludeId?: string,
  ) {
    if (input.status === 'inactive') return;
    const from = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date('1970-01-01');
    const to = input.effectiveTo ? new Date(input.effectiveTo) : new Date('2999-12-31');
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw new BadRequestException('价格规则生效日期范围无效');
    }
    const existing = await this.taskPriceRulesRepository.find({
      where: {
        customer_code: input.customerCode,
        business_category_code: input.businessCategoryCode,
        secondary_category_code: input.secondaryCategoryCode,
        tertiary_category_code: input.tertiaryCategoryCode,
        status: 'active',
      },
    });
    const overlaps = existing.some((rule) => {
      if (excludeId && rule.id === excludeId) return false;
      const existingFrom = rule.effective_from ? new Date(rule.effective_from) : new Date('1970-01-01');
      const existingTo = rule.effective_to ? new Date(rule.effective_to) : new Date('2999-12-31');
      return from <= existingTo && existingFrom <= to;
    });
    if (overlaps) {
      throw new BadRequestException('同一基金和三级分类的价格生效期间不能重叠');
    }
  }

  async resolveTertiarySelection(
    businessCategory: string | null | undefined,
    secondaryCategory: string | null | undefined,
    codes: string[],
    quantities: Record<string, unknown> = {},
  ) {
    const uniqueCodes = [
      ...new Set(codes.map((item) => String(item).trim()).filter(Boolean)),
    ];
    if (!uniqueCodes.length) return null;
    const categoryCode = this.slug(String(businessCategory ?? '').trim());
    const secondaryNameOrCode = String(secondaryCategory ?? '').trim();
    const secondary = await this.dimensionsRepository.findOne({
      where: [
        {
          dimension_type: 'secondary_category',
          dimension_code: secondaryNameOrCode,
          parent_code: categoryCode,
          status: 'active',
        },
        {
          dimension_type: 'secondary_category',
          dimension_name: secondaryNameOrCode,
          parent_code: categoryCode,
          status: 'active',
        },
      ],
    });
    if (!secondary)
      throw new BadRequestException('所选二级分类不属于当前业务大类');
    const rows = await this.dimensionsRepository.find({
      where: {
        dimension_type: 'tertiary_category',
        dimension_code: In(uniqueCodes),
        parent_code: secondary.dimension_code,
        status: 'active',
      },
      order: { sort_order: 'ASC', dimension_name: 'ASC' },
    });
    if (rows.length !== uniqueCodes.length) {
      throw new BadRequestException(
        '三级分类中包含无效项，或不属于当前二级分类',
      );
    }
    const byCode = new Map(rows.map((row) => [row.dimension_code, row]));
    const ordered = uniqueCodes.map((code) => byCode.get(code)!);
    const supportsQuantity = categoryCode === 'operation';
    const normalizedQuantities = Object.fromEntries(
      ordered.map((item) => {
        const rawQuantity = quantities?.[item.dimension_code];
        const isTimeRatio = item.score_mode === 'time_ratio';
        if (isTimeRatio) {
          const minutes = Number(rawQuantity);
          if (!Number.isFinite(minutes) || minutes <= 0) {
            throw new BadRequestException(
              '正常修改和其他需求必须填写大于0的分钟数',
            );
          }
          return [item.dimension_code, minutes];
        }
        const quantity =
          rawQuantity === undefined || rawQuantity === null || rawQuantity === ''
            ? 1
            : Number(rawQuantity);
        if (supportsQuantity && (!Number.isInteger(quantity) || quantity < 1)) {
          throw new BadRequestException('三级分类数量必须是大于等于1的整数');
        }
        return [item.dimension_code, supportsQuantity ? quantity : 1];
      }),
    ) as Record<string, number>;
    const estimatedHours = ordered
      .reduce((sum, item) => {
        const quantity = normalizedQuantities[item.dimension_code];
        return (
          sum +
          (item.score_mode === 'time_ratio'
            ? quantity / 60
            : Number(item.estimated_hours ?? 0) * quantity)
        );
      }, 0)
      .toFixed(2);
    return {
      codes: uniqueCodes,
      names: ordered.map((item) => item.dimension_name),
      quantities: normalizedQuantities,
      estimatedHours,
      contributionPoints: ordered
        .reduce((sum, item) => {
          const quantity = normalizedQuantities[item.dimension_code];
          return (
            sum +
            (item.score_mode === 'time_ratio'
              ? Math.round(
                  quantity * Number(item.score_rate ?? 0.166667),
                )
              : Number(item.contribution_points ?? 0) * quantity)
          );
        }, 0)
        .toFixed(2),
    };
  }

  private async ensureTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS dimension_dictionaries (
        id CHAR(36) NOT NULL,
        dimension_type VARCHAR(32) NOT NULL,
        dimension_code VARCHAR(64) NOT NULL,
        dimension_name VARCHAR(128) NOT NULL,
        product_type VARCHAR(32) NULL,
        parent_code VARCHAR(64) NULL,
        sort_order INT NOT NULL DEFAULT 100,
        status VARCHAR(32) NOT NULL,
        remark VARCHAR(255) NULL,
        product_code VARCHAR(32) NULL,
        standard_version VARCHAR(32) NULL,
        estimated_hours DECIMAL(8,2) NULL,
        contribution_points DECIMAL(10,2) NULL,
        measure_unit VARCHAR(32) NULL,
        content_scope TEXT NULL,
        delivery_standard TEXT NULL,
        scoring_boundary TEXT NULL,
        acceptance_evidence TEXT NULL,
        reference_minutes INT NULL,
        score_mode VARCHAR(32) NULL,
        score_rate DECIMAL(10,6) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_dimension_type_code (dimension_type, dimension_code),
        KEY idx_dimension_type_parent (dimension_type, parent_code),
        KEY idx_dimension_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务维度字典表'
    `);
  }

  private async ensureMetricColumns() {
    const definitions = [
      ['product_code', 'product_code VARCHAR(32) NULL AFTER remark'],
      ['standard_version', 'standard_version VARCHAR(32) NULL AFTER product_code'],
      ['estimated_hours', 'estimated_hours DECIMAL(8,2) NULL AFTER remark'],
      ['product_type', 'product_type VARCHAR(32) NULL AFTER dimension_name'],
      [
        'contribution_points',
        'contribution_points DECIMAL(10,2) NULL AFTER estimated_hours',
      ],
      [
        'measure_unit',
        'measure_unit VARCHAR(32) NULL AFTER contribution_points',
      ],
      ['content_scope', 'content_scope TEXT NULL AFTER measure_unit'],
      ['delivery_standard', 'delivery_standard TEXT NULL AFTER content_scope'],
      [
        'scoring_boundary',
        'scoring_boundary TEXT NULL AFTER delivery_standard',
      ],
      [
        'acceptance_evidence',
        'acceptance_evidence TEXT NULL AFTER scoring_boundary',
      ],
      [
        'reference_minutes',
        'reference_minutes INT NULL AFTER acceptance_evidence',
      ],
      ['score_mode', 'score_mode VARCHAR(32) NULL AFTER reference_minutes'],
      ['score_rate', 'score_rate DECIMAL(10,6) NULL AFTER score_mode'],
    ];
    for (const [column, definition] of definitions) {
      const rows = await this.dataSource.query<
        Array<{ count: string | number }>
      >(
        `SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dimension_dictionaries' AND column_name = ?`,
        [column],
      );
      if (Number(rows?.[0]?.count ?? 0) === 0) {
        await this.dataSource.query(
          `ALTER TABLE dimension_dictionaries ADD COLUMN ${definition}`,
        );
      }
    }
  }

  private async ensureTaskPriceRulesTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS task_price_rules (
        id CHAR(36) NOT NULL,
        customer_code VARCHAR(32) NOT NULL,
        business_category_code VARCHAR(64) NOT NULL,
        secondary_category_code VARCHAR(64) NOT NULL,
        tertiary_category_code VARCHAR(64) NOT NULL,
        pricing_mode VARCHAR(32) NOT NULL DEFAULT 'fixed',
        unit_price DECIMAL(14,2) NOT NULL DEFAULT 0,
        effective_from DATE NULL,
        effective_to DATE NULL,
        version_no INT NOT NULL DEFAULT 1,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        remark TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_task_price_rule_customer_status (customer_code, status),
        KEY idx_task_price_rule_category (business_category_code, secondary_category_code, tertiary_category_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='基金三级分类任务价格规则'
    `);
  }

  private async seedCompatibilityTertiaryCategories() {
    const secondaries = await this.findAll({
      dimensionType: 'secondary_category',
      status: 'active',
    });
    for (const secondary of secondaries) {
      const configured = await this.findAll({
        dimensionType: 'tertiary_category',
        parentCode: secondary.dimension_code,
        status: 'active',
      });
      if (configured.length) continue;
      const code = `${secondary.dimension_code}_default`;
      const existing = await this.dimensionsRepository.findOne({
        where: { dimension_type: 'tertiary_category', dimension_code: code },
      });
      if (existing) continue;
      await this.upsert({
        dimensionType: 'tertiary_category',
        dimensionCode: code,
        dimensionName: secondary.dimension_name,
        parentCode: secondary.dimension_code,
        sortOrder: 10,
        status: 'active',
        estimatedHours: '6.00',
        contributionPoints: '0.00',
        remark: '兼容既有分类的默认三级项；贡献分需由管理员按实际标准填写',
      });
    }
  }

  private contentStandardV2(): Array<{
    productCode: string;
    secondary: string;
    tertiary: string;
    unit?: string;
    minutes?: number;
    points?: number;
    scope: string;
    delivery: string;
    evidence: string;
    scoreMode?: string;
    scoreRate?: string;
  }> {
    const fixed = (
      productCode: number,
      secondary: string,
      tertiary: string,
      minutes: number,
      points: number,
      scope: string,
      delivery: string,
      evidence: string,
      unit = '',
    ) => ({
      productCode: String(productCode),
      secondary,
      tertiary,
      minutes,
      points,
      unit,
      scope,
      delivery,
      evidence,
    });
    return [
      fixed(1, '陪伴文章', '陪伴内容', 120, 20, '含数据的偏复杂内容，覆盖净值波动、持有陪伴、定投陪伴、季报解读和突发行情陪伴。', '围绕一个产品、行情节点或持有场景形成一篇完整陪伴内容。', '定稿、交付链接或客户确认记录。', '篇'),
      fixed(2, '基金经理来信', '陪伴内容', 40, 7, '基金经理来信等简单内容页面。', '形成一个可直接交付的内容 Word。', '一个内容 Word。', '篇'),
      fixed(3, '模板新作', '陪伴内容', 60, 10, '指定产品陪伴、月报或周报模板新作。', '完成一个可复用的原型图。', '一个原型图。', '篇'),
      fixed(4, '简单周报/月报套模板', '陪伴内容', 10, 2, '套模板内容为简单内容，不涉及复杂文案、图表和数据更新。', '完成一个简单套模板原型图。', '一个原型图。', '篇'),
      fixed(5, '复杂周报/月报套模板', '陪伴内容', 30, 5, '涉及复杂文案、图表或数据更新。', '完成一个复杂套模板原型图。', '一个原型图。', '篇'),
      fixed(6, '产品/行情内容', '营销内容/H5', 240, 40, '活动或 H5 页面文案、产品一页纸、问答手册等。', '围绕一个明确营销主题形成完整文章或页面文案，包含标题和主体内容。', '定稿、数据依据及交付记录。', '篇'),
      fixed(7, '社区/活动内容', '话题活动', 60, 10, '话题活动原型图页面。', '完成一个完整话题活动文案原型页面。', '原型文案或客户确认记录。', '套'),
      fixed(8, '直播/视频脚本', '直播脚本（复杂）', 120, 20, '直播提纲、完整逐字稿、主持人串词、嘉宾问题和互动环节。', '完成一场 60—90 分钟常规直播的完整脚本。', '完整脚本及客户确认记录。', '场'),
      fixed(9, '直播/视频脚本', '直播脚本（简单）', 40, 7, '基于已有模板修改、串词调整或框架填充。', '基于既有模板和明确材料，完成一场可直接使用的简单直播脚本。', '仅适用于结构基本不变、无需重新策划和大量研究的模板化脚本；从零撰写或大幅重构按复杂直播脚本计分。', '场'),
      fixed(10, '直播/视频脚本', '视频脚本', 120, 20, '口播、动画、PPT 翻页、访谈、旁白、字幕及分镜脚本。', '完成一条 1—3 分钟常规视频的完整脚本，含对应字幕或分镜说明。', '完整脚本或交付记录。', '条'),
      fixed(11, '视觉/短文案', '海报文案', 40, 7, '主副标题、数据说明、脚注及内容结构。', '完成一张海报的完整文案及内容结构。', '文案稿、原型或终稿链接。', '套'),
      fixed(12, '视觉/短文案', 'Banner/封面', 10, 2, 'Banner、文章封面、视频封面或直播封面等。', '完成一个明确需求下的 Banner 或封面主副文案。', '文案稿或终稿截图。', '套'),
      fixed(13, '视觉/短文案', '推广短文案合集', 20, 3, 'Push、弹窗、推荐位、摘要等推广短文案。', '完成一个明确需求下的推广短文案合集。', '需求记录、文案稿或客户确认记录。', '批'),
      fixed(14, '数据处理', '数据修改（常规）', 60, 10, '更新数据、日期、产品名称、基金经理、风险提示等。', '完成部分产品替换、数据更新或风险提示调整。', '修改前后文件及数据来源。', '批'),
      fixed(15, '数据处理', '数据修改（复杂）', 90, 15, '模板新找亮点、数据更新、计算口径调整和关联内容修改。', '完成复杂数据修改并保留可核验过程。', '修改终稿、数据来源或计算底稿、修改对照及确认记录。', '项'),
      fixed(16, '数据处理', '数据核验（简单）', 20, 3, '基于已有数据，核查少量数据来源、截止日期、计算口径和图文一致性。', '对一个完整文件或一组同口径数据进行独立核验。', '核验记录、修改标记或确认结果。', '项'),
      fixed(17, '数据处理', '数据核验（复杂）', 60, 10, '长内容数据重新校准。', '完成多来源数据交叉核验、重新测算、公式检查、统计口径比对及图文一致性复核。', '确认记录等。', '项'),
      fixed(18, '产品卡片', '策划与撰写', 60, 10, '产品弹窗等具有卖点实质内容的卡片，非简单文案，含赎回拦截。', '完成产品弹窗、推荐卡、产品亮点卡、持仓或自选陪伴卡等完整信息结构的卡片文案。', '卡片文案及原型等确认交付记录。', '张'),
      { productCode: '19', secondary: '正常修改', tertiary: '正常修改', unit: '项', scope: '因客户原因产生的修改需求。', delivery: '按实际修改内容完成交付。', evidence: '/', scoreMode: 'time_ratio', scoreRate: '0.166667' },
      { productCode: '20', secondary: '其他需求', tertiary: '其他需求', unit: '项', scope: '无法归入标准分类的自定义内容需求。', delivery: '按实际约定完成交付。', evidence: '/', scoreMode: 'time_ratio', scoreRate: '0.166667' },
    ];
  }

  private async syncContentStandardV2() {
    for (const standard of this.contentStandardV2()) {
      const secondaryCode = `content_${this.slug(standard.secondary)}`;
      const tertiaryCode = `${secondaryCode}_${this.slug(standard.tertiary)}`;
      const entity = await this.dimensionsRepository.findOne({
        where: {
          dimension_type: 'tertiary_category',
          dimension_code: tertiaryCode,
        },
      });
      if (!entity) continue;
      if (entity.standard_version === 'content-v2') {
        let changed = false;
        if (standard.unit && !entity.measure_unit) {
          entity.measure_unit = standard.unit;
          changed = true;
        }
        if (standard.minutes !== undefined && entity.reference_minutes == null) {
          entity.reference_minutes = standard.minutes;
          entity.estimated_hours = this.hoursFromMinutes(standard.minutes);
          changed = true;
        }
        if (standard.scoreMode && !entity.score_mode) {
          entity.score_mode = standard.scoreMode;
          changed = true;
        }
        if (standard.scoreRate && !entity.score_rate) {
          entity.score_rate = standard.scoreRate;
          changed = true;
        }
        if (changed) await this.dimensionsRepository.save(entity);
        continue;
      }
      entity.product_code = standard.productCode;
      entity.standard_version = 'content-v2';
      entity.measure_unit = standard.unit || null;
      entity.content_scope = standard.scope;
      entity.delivery_standard = standard.delivery;
      entity.acceptance_evidence = standard.evidence;
      entity.score_mode = standard.scoreMode ?? 'manual_fixed';
      entity.score_rate = standard.scoreRate ?? null;
      entity.reference_minutes = standard.minutes ?? null;
      entity.estimated_hours =
        standard.minutes === undefined
          ? null
          : this.hoursFromMinutes(standard.minutes);
      entity.contribution_points =
        standard.points === undefined ? null : standard.points.toFixed(2);
      await this.dimensionsRepository.save(entity);
    }
  }

  private async ensureBusinessCategorySecondaryTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS business_category_secondary_categories (
        id CHAR(36) NOT NULL,
        business_category_code VARCHAR(64) NOT NULL,
        business_category_name VARCHAR(64) NOT NULL,
        secondary_category_code VARCHAR(64) NOT NULL,
        secondary_category_name VARCHAR(64) NOT NULL,
        category_sort_order INT NOT NULL DEFAULT 100,
        secondary_sort_order INT NOT NULL DEFAULT 100,
        status VARCHAR(32) NOT NULL,
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_business_category_secondary (business_category_code, secondary_category_code),
        KEY idx_business_category_secondary_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务大类与二级分类关系表'
    `);
  }

  private async seedDefaults() {
    for (const item of this.defaultDimensions()) {
      const existing = await this.dimensionsRepository.findOne({
        where: {
          dimension_type: item.dimensionType,
          dimension_code: item.dimensionCode,
        },
      });
      if (existing) {
        continue;
      }
      await this.upsert({
        dimensionType: item.dimensionType,
        dimensionCode: item.dimensionCode,
        dimensionName: item.dimensionName,
        productType: item.productType ?? undefined,
        parentCode: item.parentCode ?? null,
        sortOrder: item.sortOrder ?? 100,
        status: 'active',
        productCode: item.productCode ?? undefined,
        standardVersion: item.standardVersion ?? undefined,
        estimatedHours: item.estimatedHours ?? undefined,
        contributionPoints: item.contributionPoints ?? undefined,
        measureUnit: item.measureUnit ?? undefined,
        contentScope: item.contentScope ?? undefined,
        deliveryStandard: item.deliveryStandard ?? undefined,
        scoringBoundary: item.scoringBoundary ?? undefined,
        acceptanceEvidence: item.acceptanceEvidence ?? undefined,
        referenceMinutes: item.referenceMinutes ?? undefined,
        scoreMode: item.scoreMode ?? undefined,
        scoreRate: item.scoreRate ?? undefined,
      });
    }
  }

  private async seedBusinessCategorySecondaryRelations() {
    const categories = this.businessCategorySecondarySeeds();
    const desiredCategoryCodes = new Set(
      categories.map((category) => this.slug(category.name)),
    );
    const existingCategories = await this.dimensionsRepository.find({
      where: { dimension_type: 'business_category' },
    });
    for (const category of existingCategories) {
      if (desiredCategoryCodes.has(category.dimension_code)) continue;
      category.status = 'inactive';
      await this.dimensionsRepository.save(category);
      const relations = await this.businessCategorySecondaryRepository.find({
        where: { business_category_code: category.dimension_code },
      });
      for (const relation of relations) {
        relation.status = 'inactive';
        await this.businessCategorySecondaryRepository.save(relation);
        await this.deactivateSecondaryTree(relation.secondary_category_code);
      }
    }

    for (const category of categories) {
      const categoryCode = this.slug(category.name);
      const categoryDimension = await this.dimensionsRepository.findOne({
        where: {
          dimension_type: 'business_category',
          dimension_code: categoryCode,
        },
      });
      if (
        categoryDimension &&
        (categoryDimension.status !== 'active' ||
          categoryDimension.dimension_name !== category.name)
      ) {
        categoryDimension.dimension_name = category.name;
        categoryDimension.status = 'active';
        await this.dimensionsRepository.save(categoryDimension);
      }
      for (const [index, secondaryName] of category.children.entries()) {
        const secondaryCode = `${categoryCode}_${this.slug(secondaryName)}`;
        const existing = await this.businessCategorySecondaryRepository.findOne(
          {
            where: {
              business_category_code: categoryCode,
              secondary_category_code: secondaryCode,
            },
            withDeleted: true,
          },
        );
        const entity =
          existing ?? this.businessCategorySecondaryRepository.create();
        Object.assign(entity, {
          business_category_code: categoryCode,
          business_category_name: category.name,
          secondary_category_code: secondaryCode,
          secondary_category_name: secondaryName,
          category_sort_order: category.sortOrder,
          secondary_sort_order: (index + 1) * 10,
          status: 'active',
          remark: null,
          deleted_at: null,
        });
        await this.businessCategorySecondaryRepository.save(entity);
      }
      const desiredSecondaryCodes = new Set(
        category.children.map(
          (secondaryName) => `${categoryCode}_${this.slug(secondaryName)}`,
        ),
      );
      const existingRelations =
        await this.businessCategorySecondaryRepository.find({
          where: { business_category_code: categoryCode },
        });
      for (const relation of existingRelations) {
        if (desiredSecondaryCodes.has(relation.secondary_category_code)) {
          continue;
        }
        relation.status = 'inactive';
        await this.businessCategorySecondaryRepository.save(relation);
        await this.deactivateSecondaryTree(relation.secondary_category_code);
      }
    }
  }

  private async deactivateSecondaryTree(secondaryCode: string) {
    const secondary = await this.dimensionsRepository.findOne({
      where: {
        dimension_type: 'secondary_category',
        dimension_code: secondaryCode,
      },
    });
    if (!secondary) return;
    secondary.status = 'inactive';
    await this.dimensionsRepository.save(secondary);
    const tertiaries = await this.dimensionsRepository.find({
      where: {
        dimension_type: 'tertiary_category',
        parent_code: secondary.dimension_code,
      },
    });
    for (const tertiary of tertiaries) {
      tertiary.status = 'inactive';
      await this.dimensionsRepository.save(tertiary);
    }
  }

  private defaultDimensions(): SeedDimension[] {
    return [
      ...[
        '招行',
        '工行',
        '交行',
        '建行',
        '理财通',
        '蚂蚁',
        '天天基金',
        '京东金融',
        '其它',
      ].map((name, index) => ({
        dimensionType: 'business_platform',
        dimensionCode: this.slug(name),
        dimensionName: name,
        sortOrder: (index + 1) * 10,
      })),
      ...this.categorySeeds(),
    ];
  }

  private categorySeeds(): SeedDimension[] {
    const categories = this.businessCategorySecondarySeeds();

    const rows: SeedDimension[] = [];
    categories.forEach((category) => {
      const categoryCode = this.slug(category.name);
      rows.push({
        dimensionType: 'business_category',
        dimensionCode: categoryCode,
        dimensionName: category.name,
        sortOrder: category.sortOrder,
      });
      category.children.forEach((child, childIndex) => {
        const secondaryCode = `${categoryCode}_${this.slug(child)}`;
        rows.push({
          dimensionType: 'secondary_category',
          dimensionCode: secondaryCode,
          dimensionName: child,
          parentCode: categoryCode,
          sortOrder: (childIndex + 1) * 10,
        });
        for (const [tertiaryIndex, tertiary] of (
          category.tertiaries?.[child] ?? []
        ).entries()) {
          rows.push({
            dimensionType: 'tertiary_category',
            dimensionCode: `${secondaryCode}_${this.slug(tertiary)}`,
            dimensionName: tertiary,
            parentCode: secondaryCode,
            sortOrder: (Number(tertiaryIndex) + 1) * 10,
            estimatedHours: this.hoursFromMinutes(
              category.tertiaryMetadata?.[child]?.[tertiary]?.minutes ??
                category.tertiaryMinutes?.[child]?.[tertiary] ??
                0,
            ),
            productType:
              category.tertiaryMetadata?.[child]?.[tertiary]?.productType,
            productCode:
              category.tertiaryMetadata?.[child]?.[tertiary]?.productCode,
            standardVersion:
              category.tertiaryMetadata?.[child]?.[tertiary]?.standardVersion,
            contributionPoints: (
              category.tertiaryMetadata?.[child]?.[tertiary]?.points ??
              category.tertiaryPoints?.[child]?.[tertiary] ??
              (['运营', '内容'].includes(category.name)
                ? (category.tertiaryMetadata?.[child]?.[tertiary]?.minutes ??
                    category.tertiaryMinutes?.[child]?.[tertiary] ??
                    0) / 6
                : 0)
            ).toFixed(2),
            measureUnit: category.tertiaryMetadata?.[child]?.[tertiary]?.unit,
            contentScope: category.tertiaryMetadata?.[child]?.[tertiary]?.scope,
            deliveryStandard:
              category.tertiaryMetadata?.[child]?.[tertiary]?.delivery,
            scoringBoundary:
              category.tertiaryMetadata?.[child]?.[tertiary]?.boundary,
            acceptanceEvidence:
              category.tertiaryMetadata?.[child]?.[tertiary]
                ?.acceptanceEvidence,
            referenceMinutes:
              category.tertiaryMetadata?.[child]?.[tertiary]?.minutes ??
              category.tertiaryMinutes?.[child]?.[tertiary] ??
              null,
            scoreMode:
              category.tertiaryMetadata?.[child]?.[tertiary]?.scoreMode,
            scoreRate:
              category.tertiaryMetadata?.[child]?.[tertiary]?.scoreRate ===
              undefined
                ? undefined
                : String(
                    category.tertiaryMetadata?.[child]?.[tertiary]?.scoreRate,
                  ),
          });
        }
      });
    });
    return rows;
  }

  private businessCategorySecondarySeeds(): Array<{
    name: string;
    sortOrder: number;
    children: string[];
    tertiaries?: Record<string, string[]>;
    tertiaryMinutes?: Record<string, Record<string, number>>;
    tertiaryPoints?: Record<string, Record<string, number>>;
    tertiaryMetadata?: Record<
      string,
      Record<
        string,
        {
          productType?: string;
          unit: string;
          scope: string;
          boundary: string;
          delivery: string;
          minutes: number;
          points: number;
          productCode?: string;
          standardVersion?: string;
          acceptanceEvidence?: string;
          scoreMode?: string;
          scoreRate?: number;
        }
      >
    >;
  }> {
    return [
      {
        name: '设计',
        sortOrder: 10,
        children: ['海报', '长图', 'Banner', '图标'],
        tertiaries: {
          海报: [
            '普通海报新设计',
            '精品海报新设计',
            '海报改版',
            '海报拓展（简单）',
            '海报拓展（复杂）',
          ],
          长图: [
            '长图新设计（4P以内）',
            '长图新设计（5—8P）',
            '长图增加页面/套模板',
            '长图小修改',
            '长图大改版',
          ],
          Banner: ['Banner新设计', 'Banner/巨幅拓展'],
          图标: ['单个Icon设计'],
        },
        tertiaryMetadata: {
          海报: {
            普通海报新设计: {
              unit: '张',
              minutes: 450,
              points: 75,
              scope:
                '方向明确的单张海报新设计，不含复杂原创插画或多套完整创意方案。',
              boundary:
                '同一需求正常修改已包含；更换主视觉或整体方向按改版/新设计另计。',
              delivery: '终稿文件、交付链接或客户确认记录',
            },
            精品海报新设计: {
              unit: '张',
              minutes: 900,
              points: 150,
              scope:
                '需要新创意概念、主视觉塑造、复杂合成或多套完整方向的重点海报。',
              boundary:
                '立项时确认按精品海报计；不得在完成后仅因耗时较长追加分值。',
              delivery: '终稿、源文件及创意方向确认记录',
            },
            海报改版: {
              unit: '张',
              minutes: 450,
              points: 75,
              scope: '基于既有海报，对整体版式、主视觉或风格进行明显重构。',
              boundary: '仅替换尺寸、文案或基础信息不属于改版，应计海报拓展。',
              delivery: '改版前后对比及终稿',
            },
            '海报拓展（简单）': {
              unit: '张',
              minutes: 60,
              points: 10,
              scope: '沿用既有视觉和布局，主要调整尺寸、文案或基础信息。',
              boundary: '同一母版产生多张成品时按实际验收张数计。',
              delivery: '拓展成品及对应母版',
            },
            '海报拓展（复杂）': {
              unit: '张',
              minutes: 180,
              points: 30,
              scope: '沿用核心视觉，但因比例或内容变化需要较大幅度重新排版。',
              boundary: '仅做尺寸适配不得按复杂拓展计；立项时先确认类型。',
              delivery: '拓展成品及对应母版',
            },
          },
          长图: {
            '长图新设计（4P以内）': {
              unit: '项',
              minutes: 630,
              points: 105,
              scope: '4P以内、非手绘漫画类长图的新设计。',
              boundary: '同一主题连续页面作为一项；超出4P按5—8P或增加页面计。',
              delivery: '完整长图、源文件或交付链接',
            },
            '长图新设计（5—8P）': {
              unit: '项',
              minutes: 900,
              points: 150,
              scope: '5—8P、非手绘漫画类长图的新设计。',
              boundary:
                '超过8P且沿用同一视觉时，超出部分按增加页面计；重大新方向另行审批。',
              delivery: '完整长图、源文件或交付链接',
            },
            '长图增加页面/套模板': {
              unit: 'P',
              minutes: 24,
              points: 4,
              scope: '在已确认视觉或模板基础上增加页面、替换内容并完成适配。',
              boundary:
                '按实际验收页数计；若需要重新建立整套视觉，不得按套模板计。',
              delivery: '新增页面及对应模板',
            },
            长图小修改: {
              unit: '项',
              minutes: 180,
              points: 30,
              scope: '不改变整体视觉方向的局部内容、元素或版式调整。',
              boundary: '同一轮同一需求合并为一项，不按修改次数重复计。',
              delivery: '修改前后对比及终稿',
            },
            长图大改版: {
              unit: '项',
              minutes: 450,
              points: 75,
              scope: '整体版式、核心视觉或主要内容结构发生明显变化。',
              boundary:
                '由需求方改变已确认方向导致的，可按大改版计；设计自误返工不计。',
              delivery: '改版前后对比及确认记录',
            },
          },
          Banner: {
            Banner新设计: {
              unit: '张',
              minutes: 60,
              points: 10,
              scope: '独立Banner或巨幅的新视觉设计。',
              boundary: '同一视觉的其他尺寸使用拓展产品，不重复计新设计。',
              delivery: '终稿或上线截图',
            },
            'Banner/巨幅拓展': {
              unit: '张',
              minutes: 30,
              points: 5,
              scope: '沿用已确认主视觉进行尺寸、文案或信息适配。',
              boundary: '按验收成品张数计；设计自误返工不增加数量。',
              delivery: '拓展成品及对应母版',
            },
          },
          图标: {
            单个Icon设计: {
              unit: '个',
              minutes: 60,
              points: 10,
              scope: '单个具有独立识别性的图标设计。',
              boundary:
                '同一套图标按实际验收个数计；轻微变色或尺寸变化不重复计。',
              delivery: '终稿、图标规范或交付文件',
            },
          },
        },
      },
      {
        name: '运营',
        sortOrder: 30,
        children: Object.keys(this.operationTertiaryMetadata()),
        tertiaries: Object.fromEntries(
          Object.entries(this.operationTertiaryMetadata()).map(
            ([secondary, metadata]) => [secondary, Object.keys(metadata)],
          ),
        ),
        tertiaryMetadata: this.operationTertiaryMetadata(),
      },
      {
        name: '内容',
        sortOrder: 50,
        children: [
          '产品/行情内容',
          '社区/活动内容',
          '直播/视频脚本',
          '视觉/短文案',
          'PPT/方案材料',
          '数据处理',
          '文案修改/审核',
          '产品征信卡片',
          '陪伴文章',
          '基金经理来信',
          '模板新作',
          '简单周报/月报套模板',
          '复杂周报/月报套模板',
          '产品卡片',
          '正常修改',
          '其他需求',
          'KOC内容',
        ],
        tertiaries: {
          '产品/行情内容': ['投教内容', '陪伴内容', '营销内容/H5'],
          '社区/活动内容': ['话题活动'],
          '直播/视频脚本': [
            '直播脚本（复杂）',
            '直播脚本（简单）',
            '视频脚本',
            '配套文案',
          ],
          '视觉/短文案': [
            '海报文案',
            'Banner/封面',
            '渠道短文案',
            '推广短文案合集',
          ],
          'PPT/方案材料': ['PPT文案', '方案报告'],
          数据处理: [
            '数据修改（常规）',
            '数据修改（复杂）',
            '数据加工（常规）',
            '数据加工（复杂）',
            '数据核验（简单）',
            '数据核验（复杂）',
          ],
          '文案修改/审核': ['文案修改/优化/更新', '审核校对'],
          产品征信卡片: ['策划与撰写'],
          陪伴文章: ['陪伴内容'],
          基金经理来信: ['陪伴内容'],
          模板新作: ['陪伴内容'],
          '简单周报/月报套模板': ['陪伴内容'],
          '复杂周报/月报套模板': ['陪伴内容'],
          产品卡片: ['策划与撰写'],
          正常修改: ['正常修改'],
          其他需求: ['其他需求'],
          KOC内容: [
            '基础短帖安排（不写内容）',
            '氛围帖（一批10～50条）',
            '氛围帖（一批51～100条）',
            '氛围帖（一批101～150条）',
            '氛围帖（一批151～200条）',
            '精品长帖',
          ],
        },
        tertiaryMetadata: {
          KOC内容: {
            '基础短帖安排（不写内容）': {
              unit: '批', scope: '', boundary: '', delivery: '', minutes: 10, points: 2,
            },
            '氛围帖（一批10～50条）': {
              unit: '批', scope: '', boundary: '', delivery: '', minutes: 30, points: 5,
            },
            '氛围帖（一批51～100条）': {
              unit: '批', scope: '', boundary: '', delivery: '', minutes: 60, points: 10,
            },
            '氛围帖（一批101～150条）': {
              unit: '批', scope: '', boundary: '', delivery: '', minutes: 90, points: 15,
            },
            '氛围帖（一批151～200条）': {
              unit: '批', scope: '', boundary: '', delivery: '', minutes: 120, points: 20,
            },
            精品长帖: {
              unit: '篇', scope: '', boundary: '', delivery: '', minutes: 20, points: 4,
            },
          },
        },
        tertiaryMinutes: {
          '产品/行情内容': { 投教内容: 120, 陪伴内容: 150, '营销内容/H5': 150 },
          '社区/活动内容': { 话题活动: 30 },
          '直播/视频脚本': {
            '直播脚本（复杂）': 300,
            '直播脚本（简单）': 60,
            视频脚本: 60,
            配套文案: 10,
          },
          '视觉/短文案': { 海报文案: 30, 'Banner/封面': 10, 渠道短文案: 15 },
          'PPT/方案材料': { PPT文案: 240, 方案报告: 240 },
          数据处理: {
            '数据修改（常规）': 60,
            '数据修改（复杂）': 90,
            '数据加工（常规）': 60,
            '数据加工（复杂）': 90,
            '数据核验（简单）': 15,
            '数据核验（复杂）': 60,
          },
          '文案修改/审核': { '文案修改/优化/更新': 60, 审核校对: 30 },
          产品征信卡片: { 策划与撰写: 60 },
        },
      },
    ];
  }

  private operationTertiaryMetadata(): Record<
    string,
    Record<
      string,
      {
        productType: string;
        unit: string;
        scope: string;
        boundary: string;
        delivery: string;
        minutes: number;
        points: number;
      }
    >
  > {
    const fixed = '固定标准产品';
    const nonStandard = '非标产品';
    const item = (
      productType: string,
      unit: string,
      minutes: number,
      scope: string,
      delivery: string,
    ) => ({
      productType,
      unit,
      minutes,
      points: Number((minutes / 6).toFixed(2)),
      scope,
      boundary: '',
      delivery,
    });

    return {
      内容发布: {
        '图文/观点发布（内容已定稿）': item(
          fixed,
          '篇·渠道',
          5,
          '发布成功并检查前台展示',
          '发布链接/截图',
        ),
        '图文/资讯发布（含内容或图片修改审核）': item(
          nonStandard,
          '篇·渠道',
          30,
          '修改审核完成并发布留痕',
          '修改稿+发布链接/截图',
        ),
        讨论区内容发布: item(
          fixed,
          '篇·讨论区',
          3,
          '指定讨论区发布完成并留痕',
          '帖子链接/截图',
        ),
        '图文/观点发布（补充配置或轻量调整）': item(
          fixed,
          '篇·渠道',
          15,
          '产品关联、信息填写及发布均正确',
          '发布链接/截图',
        ),
        '长图发布（素材已定稿）': item(
          fixed,
          '篇·渠道',
          3,
          '发布成功并检查清晰度和展示',
          '发布链接/截图',
        ),
        '长图发布（含产品卡/多个链接）': item(
          fixed,
          '篇·渠道',
          8,
          '全部产品卡和链接配置正确',
          '发布链接/截图',
        ),
        '长图发布（含改图）': item(
          nonStandard,
          '篇·渠道',
          20,
          '改图、发布及前台检查完成',
          '成图+发布链接/截图',
        ),
        视频发布: item(
          fixed,
          '条·渠道',
          3,
          '发布完成并检查播放与展示',
          '发布链接/截图',
        ),
        '活动统计/合集推送发布': item(
          nonStandard,
          '次',
          45,
          '统计、合集输出、配置及发布全部完成',
          '统计表+发布链接/截图',
        ),
      },
      活动运营: {
        活动基础配置: item(
          fixed,
          '活动',
          25,
          '基础配置、测试和上线检查完成',
          '后台截图/测试记录',
        ),
        活动全流程配置: item(
          nonStandard,
          '活动',
          90,
          '全部配置、审核、报备、测试和上线完成',
          '表单/邮件/后台截图/测试记录',
        ),
        活动选奖: item(
          nonStandard,
          '批次',
          20,
          '按规则完成筛选、核对和留痕',
          '候选/获奖名单+截图',
        ),
        FAQ修改: item(
          fixed,
          '次',
          5,
          'FAQ更新正确并检查展示',
          '页面截图/确认记录',
        ),
        发奖全流程: item(
          nonStandard,
          '话题·批',
          120,
          '名单复核、发放、异常处理和留痕完成',
          '发奖记录/截图/名单',
        ),
      },
      陪伴运营: {
        陪伴内容修改及配置: item(
          nonStandard,
          '次/批次',
          15,
          '修改、发布和检查完成',
          '修改稿+发布截图',
        ),
        陪伴页面全流程配置: item(
          nonStandard,
          '页',
          60,
          '审核、整理、提报、发布、台账全部完成',
          '确认记录+页面截图+台账',
        ),
        '陪伴内容发布/更新': item(
          fixed,
          '次·渠道',
          3,
          '陪伴发布完成并检查展示',
          '发布截图/链接',
        ),
      },
      后台配置: {
        H5配置与提报: item(
          nonStandard,
          '页',
          60,
          '审核、修改、上传、表单及报备完成',
          '表单/邮件/页面截图',
        ),
        页面及素材更新: item(
          fixed,
          '次/页',
          5,
          '更新完成并检查展示',
          '页面截图/链接',
        ),
        魔秀基础配置: item(
          fixed,
          '次',
          15,
          '基础配置、测试和展示检查完成',
          '后台截图/测试记录',
        ),
        魔秀复杂配置: item(
          nonStandard,
          '次',
          30,
          '配置、测试、修正和留痕完成',
          '后台截图/测试记录',
        ),
        推广栏位配置: item(
          fixed,
          '栏位',
          5,
          '栏位配置完成并检查跳转',
          '后台截图/页面截图',
        ),
      },
      审核提报: {
        视频审核: item(
          fixed,
          '条',
          5,
          '完成审核并反馈明确结论',
          '审核记录/反馈截图',
        ),
        '素材审核、改图及消保提报': item(
          nonStandard,
          '批次',
          30,
          '审核、修改意见或改图交付完成',
          '修改稿/反馈记录',
        ),
      },
      客户服务: {
        客户日常沟通及需求管理: item(
          nonStandard,
          '客户·周',
          30,
          '客户需求已回应、确认、分派并推动闭环',
          '沟通记录/需求清单',
        ),
        复杂需求多轮确认及修改闭环: item(
          nonStandard,
          '事项',
          60,
          '口径和版本确认完成，相关修改全部闭环',
          '沟通记录/版本记录/确认截图',
        ),
        客户会议及会议纪要: item(
          nonStandard,
          '场',
          60,
          '会议完成，纪要、待办和责任人已确认',
          '会议纪要/待办清单',
        ),
      },
      项目协同: {
        项目进度跟踪及跨团队协同: item(
          nonStandard,
          '项目·周',
          60,
          '进度更新、风险上报、跨团队事项和待办均已闭环',
          '进度表/任务记录/会议纪要',
        ),
        '平台异常/专项问题处理': item(
          nonStandard,
          '事项',
          60,
          '问题排查、协调、恢复、反馈和留痕全部完成',
          '问题记录/沟通截图/恢复截图',
        ),
      },
      社区运营: {
        讨论区巡检: item(
          fixed,
          '讨论区·次',
          2,
          '巡检完成，异常已记录或上报',
          '巡检记录/截图',
        ),
        官方回复: item(
          fixed,
          '条',
          3,
          '回复完成、口径无误并留痕',
          '回复截图/链接',
        ),
      },
      直播运营: {
        直播间配置: item(
          fixed,
          '场',
          30,
          '直播间配置及测试完成',
          '后台截图/测试记录',
        ),
      },
    };
  }

  private hoursFromMinutes(minutes: number) {
    return (minutes / 60).toFixed(2);
  }

  private slug(value: string) {
    const fixed: Record<string, string> = {
      招行: 'cmb',
      工行: 'icbc',
      交行: 'bocom',
      建行: 'ccb',
      理财通: 'licaitong',
      蚂蚁: 'ant',
      天天基金: 'eastmoney',
      京东金融: 'jd_finance',
      其它: 'other',
      设计: 'design',
      文案: 'copywriting',
      运营: 'operation',
      社区: 'community',
      内容组: 'content',
      内容: 'content',
      '（其他）': 'other',
    };
    return (
      fixed[value] ??
      value
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '')
    );
  }
}
