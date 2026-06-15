import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UpdateDimensionDictionaryDto } from './dto/update-dimension-dictionary.dto';
import { UpsertDimensionDictionaryDto } from './dto/upsert-dimension-dictionary.dto';
import { BusinessCategorySecondaryCategoryEntity } from './entities/business-category-secondary-category.entity';
import { DimensionDictionaryEntity } from './entities/dimension-dictionary.entity';

type SeedDimension = {
  dimensionType: string;
  dimensionCode: string;
  dimensionName: string;
  parentCode?: string | null;
  sortOrder?: number;
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
    await this.ensureBusinessCategorySecondaryTable();
    await this.seedDefaults();
    await this.seedBusinessCategorySecondaryRelations();
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
      parent_code: dto.parentCode ?? null,
      sort_order: dto.sortOrder ?? entity.sort_order ?? 100,
      status: dto.status ?? entity.status ?? 'active',
      remark: dto.remark ?? entity.remark ?? null,
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
      parent_code:
        dto.parentCode !== undefined ? dto.parentCode : entity.parent_code,
      sort_order: dto.sortOrder ?? entity.sort_order,
      status: dto.status ?? entity.status,
      remark: dto.remark !== undefined ? dto.remark : entity.remark,
    });
    return this.dimensionsRepository.save(entity);
  }

  private async ensureTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS dimension_dictionaries (
        id CHAR(36) NOT NULL,
        dimension_type VARCHAR(32) NOT NULL,
        dimension_code VARCHAR(64) NOT NULL,
        dimension_name VARCHAR(128) NOT NULL,
        parent_code VARCHAR(64) NULL,
        sort_order INT NOT NULL DEFAULT 100,
        status VARCHAR(32) NOT NULL,
        remark VARCHAR(255) NULL,
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
      await this.upsert({
        dimensionType: item.dimensionType,
        dimensionCode: item.dimensionCode,
        dimensionName: item.dimensionName,
        parentCode: item.parentCode ?? null,
        sortOrder: item.sortOrder ?? 100,
        status: 'active',
      });
    }
  }

  private async seedBusinessCategorySecondaryRelations() {
    for (const category of this.businessCategorySecondarySeeds()) {
      const categoryCode = this.slug(category.name);
      for (const [index, secondaryName] of category.children.entries()) {
        const secondaryCode = `${categoryCode}_${this.slug(secondaryName)}`;
        const existing =
          await this.businessCategorySecondaryRepository.findOne({
            where: {
              business_category_code: categoryCode,
              secondary_category_code: secondaryCode,
            },
            withDeleted: true,
          });
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
    }
  }

  private defaultDimensions(): SeedDimension[] {
    return [
      ...['招行', '工行', '交行', '理财通', '蚂蚁', '天天基金'].map(
        (name, index) => ({
          dimensionType: 'business_platform',
          dimensionCode: this.slug(name),
          dimensionName: name,
          sortOrder: (index + 1) * 10,
        }),
      ),
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
        rows.push({
          dimensionType: 'secondary_category',
          dimensionCode: `${categoryCode}_${this.slug(child)}`,
          dimensionName: child,
          parentCode: categoryCode,
          sortOrder: (childIndex + 1) * 10,
        });
      });
    });
    return rows;
  }

  private businessCategorySecondarySeeds(): Array<{
    name: string;
    sortOrder: number;
    children: string[];
  }> {
    return [
      {
        name: '设计',
        sortOrder: 10,
        children: [
          '配图拓展',
          'banner新设计',
          '巨幅新设计',
          '长图新设计',
          '长图拓展',
          '长图套模板',
          '（其他）',
        ],
      },
      {
        name: '文案',
        sortOrder: 20,
        children: [
          '数据更新',
          '已有素材新编辑',
          '原创文案',
          '共建文案',
          '（其他）',
        ],
      },
      {
        name: '运营',
        sortOrder: 30,
        children: [
          '发布陪伴',
          '活动配置',
          '魔秀搭建',
          '页面推厂',
          '直播配置',
          '（其他）',
        ],
      },
      {
        name: '社区',
        sortOrder: 40,
        children: ['粉丝投放', '精华贴', '氛围贴', '（其他）'],
      },
    ];
  }

  private slug(value: string) {
    const fixed: Record<string, string> = {
      招行: 'cmb',
      工行: 'icbc',
      交行: 'bocom',
      理财通: 'licaitong',
      蚂蚁: 'ant',
      天天基金: 'eastmoney',
      设计: 'design',
      文案: 'copywriting',
      运营: 'operation',
      社区: 'community',
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
