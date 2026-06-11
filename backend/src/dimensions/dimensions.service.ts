import { Injectable, OnModuleInit, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UpdateDimensionDictionaryDto } from './dto/update-dimension-dictionary.dto';
import { UpsertDimensionDictionaryDto } from './dto/upsert-dimension-dictionary.dto';
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
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    await this.ensureTable();
    await this.seedDefaults();
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
    const categories: Array<{ name: string; children: string[] }> = [
      {
        name: '设计',
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
        children: ['粉丝投放', '精华贴', '氛围贴', '（其他）'],
      },
    ];

    const rows: SeedDimension[] = [];
    categories.forEach((category, categoryIndex) => {
      const categoryCode = this.slug(category.name);
      rows.push({
        dimensionType: 'business_category',
        dimensionCode: categoryCode,
        dimensionName: category.name,
        sortOrder: (categoryIndex + 1) * 10,
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
