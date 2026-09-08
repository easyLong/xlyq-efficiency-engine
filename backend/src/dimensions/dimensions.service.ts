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

type SeedDimension = {
  dimensionType: string;
  dimensionCode: string;
  dimensionName: string;
  productType?: string | null;
  parentCode?: string | null;
  sortOrder?: number;
  estimatedHours?: string | null;
  contributionPoints?: string | null;
  measureUnit?: string | null;
  contentScope?: string | null;
  deliveryStandard?: string | null;
  scoringBoundary?: string | null;
  referenceMinutes?: number | null;
};

@Injectable()
export class DimensionsService implements OnModuleInit {
  constructor(
    @InjectRepository(DimensionDictionaryEntity)
    private readonly dimensionsRepository: Repository<DimensionDictionaryEntity>,
    @InjectRepository(BusinessCategorySecondaryCategoryEntity)
    private readonly businessCategorySecondaryRepository: Repository<BusinessCategorySecondaryCategoryEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureTable();
    await this.ensureMetricColumns();
    await this.ensureBusinessCategorySecondaryTable();
    await this.seedDefaults();
    await this.seedBusinessCategorySecondaryRelations();
    await this.syncCategoryTertiaryMetrics();
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
              estimatedHours: tertiary.estimated_hours ?? '0.00',
              contributionPoints: tertiary.contribution_points ?? '0.00',
              measureUnit: tertiary.measure_unit,
              contentScope: tertiary.content_scope,
              deliveryStandard: tertiary.delivery_standard,
              scoringBoundary: tertiary.scoring_boundary,
              referenceMinutes: tertiary.reference_minutes,
              sortOrder: tertiary.sort_order,
            })),
        })),
    }));
  }

  async resolveTertiarySelection(
    businessCategory: string | null | undefined,
    secondaryCategory: string | null | undefined,
    codes: string[],
  ) {
    const uniqueCodes = [
      ...new Set(codes.map((item) => String(item).trim()).filter(Boolean)),
    ];
    if (!uniqueCodes.length) return null;
    const categoryCode = String(businessCategory ?? '').trim();
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
    const total = (field: 'estimated_hours' | 'contribution_points') =>
      ordered
        .reduce((sum, item) => sum + Number(item[field] ?? 0), 0)
        .toFixed(2);
    return {
      codes: uniqueCodes,
      names: ordered.map((item) => item.dimension_name),
      estimatedHours: total('estimated_hours'),
      contributionPoints: total('contribution_points'),
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
        estimated_hours DECIMAL(8,2) NULL,
        contribution_points DECIMAL(10,2) NULL,
        measure_unit VARCHAR(32) NULL,
        content_scope TEXT NULL,
        delivery_standard TEXT NULL,
        scoring_boundary TEXT NULL,
        reference_minutes INT NULL,
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
        'reference_minutes',
        'reference_minutes INT NULL AFTER scoring_boundary',
      ],
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
        remark: '兼容既有分类的默认三级项，请按实际标准调整工时与积分',
      });
    }
  }

  private async syncCategoryTertiaryMetrics() {
    const targetCategories = new Set(['operation', 'content']);
    for (const item of this.categorySeeds()) {
      if (
        item.dimensionType !== 'tertiary_category' ||
        !item.parentCode ||
        !targetCategories.has(item.parentCode.split('_')[0])
      ) {
        continue;
      }
      const existing = await this.dimensionsRepository.findOne({
        where: {
          dimension_type: 'tertiary_category',
          dimension_code: item.dimensionCode,
        },
      });
      if (!existing) continue;
      existing.estimated_hours =
        item.estimatedHours ?? existing.estimated_hours;
      existing.contribution_points =
        item.contributionPoints ?? existing.contribution_points;
      existing.reference_minutes =
        item.referenceMinutes ?? existing.reference_minutes;
      await this.dimensionsRepository.save(existing);
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
        estimatedHours: item.estimatedHours ?? undefined,
        contributionPoints: item.contributionPoints ?? undefined,
        measureUnit: item.measureUnit ?? undefined,
        contentScope: item.contentScope ?? undefined,
        deliveryStandard: item.deliveryStandard ?? undefined,
        scoringBoundary: item.scoringBoundary ?? undefined,
        referenceMinutes: item.referenceMinutes ?? undefined,
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
            referenceMinutes:
              category.tertiaryMetadata?.[child]?.[tertiary]?.minutes ??
              category.tertiaryMinutes?.[child]?.[tertiary] ??
              null,
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
          '视觉/短文案': ['海报文案', 'Banner/封面', '渠道短文案'],
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
