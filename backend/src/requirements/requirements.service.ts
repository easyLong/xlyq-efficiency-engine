import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { getAiPrompt } from '../ai-prompts/prompt-registry';
import {
  buildAccessProfile,
  normalizeAccessBusinessCategory,
} from '../common/access-control';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { ensureIndex } from '../common/schema-maintenance';
import { ContactContextConfigEntity } from '../contact-contexts/entities/contact-context-config.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectEntity } from '../projects/entities/project.entity';
import { QuotationItemEntity } from '../quotations/entities/quotation-item.entity';
import { RequirementQuotationMappingEntity } from '../quotations/entities/requirement-quotation-mapping.entity';
import { TaskDirectoryEntity } from '../tasks/entities/task-directory.entity';
import { TaskResultFileEntity } from '../tasks/entities/task-result-file.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { UserEntity } from '../users/entities/user.entity';
import { AiMatchRequirementContextDto } from './dto/ai-match-requirement-context.dto';
import { AiSplitRequirementsDto } from './dto/ai-split-requirements.dto';
import { CreateRequirementDto } from './dto/create-requirement.dto';
import { CreateRequirementWithTaskDto } from './dto/create-requirement-with-task.dto';
import { CreateRequirementItemDto } from './dto/create-requirement-item.dto';
import { UpdateRequirementDto } from './dto/update-requirement.dto';
import { UpdateRequirementItemDto } from './dto/update-requirement-item.dto';
import { RequirementItemEntity } from './entities/requirement-item.entity';
import { RequirementEntity } from './entities/requirement.entity';

@Injectable()
export class RequirementsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequirementsService.name);
  private readonly defaultListLimit = 500;
  private aiPreviewNotificationTimer: NodeJS.Timeout | null = null;
  private aiPreviewNotificationRunning = false;

  private readonly projectTypes = [
    {
      value: 'design',
      label: '设计',
      keywords: [
        '配图',
        'banner',
        'Banner',
        '巨幅',
        '长图',
        '海报',
        '设计',
        '套模板',
        '视觉',
        '物料',
      ],
    },
    {
      value: 'copywriting',
      label: '文案',
      keywords: [
        '文案',
        '原创',
        '共建',
        '数据更新',
        '素材编辑',
        '编辑',
        'word',
        'Word',
        'WORD',
        'word版本',
        '推文',
        '策划',
        '方案',
      ],
    },
    {
      value: 'operation',
      label: '运营',
      keywords: [
        '发布',
        '陪伴',
        '活动配置',
        '魔秀',
        '页面',
        '推厂',
        '直播',
        '配置',
        '运营',
      ],
    },
    {
      value: 'community',
      label: '社区',
      keywords: ['社区', '粉丝投放', '精华贴', '氛围贴', '讨论区', '配置圈'],
    },
  ];
  constructor(
    @InjectRepository(RequirementEntity)
    private readonly requirementsRepository: Repository<RequirementEntity>,
    @InjectRepository(RequirementItemEntity)
    private readonly requirementItemsRepository: Repository<RequirementItemEntity>,
    @InjectRepository(AiExecutionLogEntity)
    private readonly aiExecutionLogsRepository: Repository<AiExecutionLogEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(TaskDirectoryEntity)
    private readonly taskDirectoriesRepository: Repository<TaskDirectoryEntity>,
    @InjectRepository(TaskResultFileEntity)
    private readonly taskResultFilesRepository: Repository<TaskResultFileEntity>,
    @InjectRepository(CustomerEntity)
    private readonly customersRepository: Repository<CustomerEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    @InjectRepository(ContactContextConfigEntity)
    private readonly contactContextsRepository: Repository<ContactContextConfigEntity>,
    @InjectRepository(RequirementQuotationMappingEntity)
    private readonly mappingsRepository: Repository<RequirementQuotationMappingEntity>,
    @InjectRepository(QuotationItemEntity)
    private readonly quotationItemsRepository: Repository<QuotationItemEntity>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.ensureRequirementsSchema();
    await this.ensureBusinessCategoryOwnerConfigTable();
    await this.normalizeBusinessCategoryOwnerConfigUsers();
    await this.ensureDemandIntakeTables();
    await this.backfillTaskReportersFromBusinessCategoryOwners();
    this.startAiPreviewNotificationScanner();
  }

  onModuleDestroy() {
    if (this.aiPreviewNotificationTimer) {
      clearInterval(this.aiPreviewNotificationTimer);
      this.aiPreviewNotificationTimer = null;
    }
  }

  async findAll(projectId?: string) {
    return this.requirementsRepository.find({
      where: projectId ? { project_id: projectId } : {},
      order: { created_at: 'DESC' },
      take: this.defaultListLimit,
    });
  }

  async historyBoard(currentUser: UserEntity | null = null) {
    const profile = currentUser
      ? await buildAccessProfile(this.dataSource, currentUser)
      : null;
    const quoteVisible = profile?.dataScope.quotes === 'all';
    let requirements = await this.findAll();
    const requirementIds = requirements.map((requirement) => requirement.id);
    if (requirementIds.length === 0) {
      return {
        requirements: [],
        requirementItems: [],
        tasks: [],
        quoteMappings: [],
      };
    }

    const requirementItems = await this.requirementItemsRepository.find({
      where: { requirement_id: In(requirementIds) },
      order: { created_at: 'ASC' },
    });
    const requirementItemIds = requirementItems.map((item) => item.id);
    if (requirementItemIds.length === 0) {
      return {
        requirements,
        requirementItems,
        tasks: [],
        quoteMappings: [],
      };
    }

    const [tasks, quoteMappings] = await Promise.all([
      this.tasksRepository.find({
        where: { requirement_item_id: In(requirementItemIds) },
        order: { created_at: 'DESC' },
      }),
      quoteVisible
        ? this.mappingsRepository.find({
            where: { requirement_item_id: In(requirementItemIds) },
            order: { created_at: 'DESC' },
          })
        : Promise.resolve([]),
    ]);
    const scoped = this.scopeHistoryBoardRows(
      requirements,
      requirementItems,
      tasks,
      profile,
      currentUser,
    );
    requirements = scoped.requirements;
    const scopedRequirementItems = scoped.requirementItems;
    const scopedTasks = scoped.tasks;
    const scopedItemIds = new Set(scopedRequirementItems.map((item) => item.id));
    const scopedQuoteMappings = quoteVisible
      ? quoteMappings.filter((mapping) =>
          scopedItemIds.has(mapping.requirement_item_id),
        )
      : [];
    const mappingsByRequirementItemId = new Map<
      string,
      RequirementQuotationMappingEntity[]
    >();
    for (const mapping of scopedQuoteMappings) {
      const rows =
        mappingsByRequirementItemId.get(mapping.requirement_item_id) ?? [];
      rows.push(mapping);
      mappingsByRequirementItemId.set(mapping.requirement_item_id, rows);
    }
    for (const item of scopedRequirementItems) {
      item.quote_scope_status = quoteVisible
        ? this.resolveQuoteScopeStatus(
            mappingsByRequirementItemId.get(item.id) ?? [],
          )
        : 'hidden';
    }

    return {
      requirements,
      requirementItems: scopedRequirementItems,
      tasks: scopedTasks,
      quoteMappings: scopedQuoteMappings,
    };
  }

  private scopeHistoryBoardRows(
    requirements: RequirementEntity[],
    requirementItems: RequirementItemEntity[],
    tasks: TaskEntity[],
    profile: Awaited<ReturnType<typeof buildAccessProfile>> | null,
    currentUser: UserEntity | null,
  ) {
    if (!profile || profile.dataScope.requirements === 'all') {
      return { requirements, requirementItems, tasks };
    }

    const taskByItemId = new Map(
      tasks.map((task) => [task.requirement_item_id, task]),
    );
    const itemByRequirementId = new Map(
      requirementItems.map((item) => [item.requirement_id, item]),
    );

    const visibleRequirementIds = new Set<string>();
    if (profile.dataScope.requirements === 'owned') {
      const ownedCategories = new Set(profile.ownedBusinessCategoryCodes);
      for (const requirement of requirements) {
        const item = itemByRequirementId.get(requirement.id);
        const task = item ? taskByItemId.get(item.id) : null;
        const requirementCategory = normalizeAccessBusinessCategory(
          requirement.business_category,
        );
        if (
          ownedCategories.has(requirementCategory) ||
          task?.reporter_user_id === currentUser?.id
        ) {
          visibleRequirementIds.add(requirement.id);
        }
      }
    } else {
      for (const item of requirementItems) {
        const task = taskByItemId.get(item.id);
        if (task?.assignee_user_id === currentUser?.id) {
          visibleRequirementIds.add(item.requirement_id);
        }
      }
    }

    const visibleRequirements = requirements.filter((requirement) =>
      visibleRequirementIds.has(requirement.id),
    );
    const visibleItemIds = new Set<string>();
    const visibleItems = requirementItems.filter((item) => {
      const visible = visibleRequirementIds.has(item.requirement_id);
      if (visible) {
        visibleItemIds.add(item.id);
      }
      return visible;
    });
    const visibleTasks = tasks.filter(
      (task) =>
        Boolean(task.requirement_item_id) &&
        visibleItemIds.has(task.requirement_item_id!),
    );
    return {
      requirements: visibleRequirements,
      requirementItems: visibleItems,
      tasks: visibleTasks,
    };
  }

  async listBusinessCategoryOwners() {
    await this.ensureBusinessCategoryOwnerConfigTable();
    return this.dataSource.query(`
      SELECT
        config.id,
        config.business_category_code AS businessCategoryCode,
        config.business_category_name AS businessCategoryName,
        config.owner_user_id AS ownerUserId,
        user.display_name AS ownerName,
        user.username AS ownerUsername,
        config.status,
        config.remark,
        config.updated_at AS updatedAt
      FROM business_category_owner_configs config
      LEFT JOIN users user ON user.id = config.owner_user_id
      WHERE config.deleted_at IS NULL
      ORDER BY FIELD(config.business_category_code, 'design', 'copywriting', 'operation', 'community'), config.business_category_code
    `);
  }

  async updateBusinessCategoryOwner(
    categoryCode: string,
    dto: { ownerUserId?: string | null },
  ) {
    await this.ensureBusinessCategoryOwnerConfigTable();
    const normalizedCategoryCode =
      this.normalizeBusinessCategoryCode(categoryCode);
    if (!normalizedCategoryCode) {
      throw new BadRequestException('Business category is required');
    }

    const ownerUserId = await this.resolveBusinessCategoryOwnerReference(
      dto.ownerUserId,
      true,
    );
    if (!ownerUserId) {
      await this.dataSource.query(
        `
          UPDATE business_category_owner_configs
          SET status = 'inactive',
              deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP),
              updated_at = CURRENT_TIMESTAMP
          WHERE business_category_code = ?
            AND deleted_at IS NULL
        `,
        [normalizedCategoryCode],
      );
      await this.backfillTaskReportersForBusinessCategory(
        normalizedCategoryCode,
      );
      return this.listBusinessCategoryOwners();
    }

    await this.dataSource.query(
      `
        INSERT INTO business_category_owner_configs (
          id,
          business_category_code,
          business_category_name,
          owner_user_id,
          status,
          remark
        )
        VALUES (?, ?, ?, ?, 'active', '按业务大类配置需求负责人')
        ON DUPLICATE KEY UPDATE
          business_category_name = VALUES(business_category_name),
          status = 'active',
          deleted_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      `,
      [
        randomUUID(),
        normalizedCategoryCode,
        this.businessCategoryName(normalizedCategoryCode),
        ownerUserId,
      ],
    );

    await this.backfillTaskReportersForBusinessCategory(
      normalizedCategoryCode,
    );
    return this.listBusinessCategoryOwners();
  }

  async listAiPreviewCandidates(
    limit = 12,
    scope = 'mine',
    currentUser: UserEntity | null = null,
  ) {
    const normalizedLimit = Math.max(1, Math.min(100, Number(limit) || 12));
    await this.assignAiPreviewReviewOwners();
    await this.notifyAiPreviewReviewOwners();
    const profile = currentUser
      ? await buildAccessProfile(this.dataSource, currentUser)
      : null;
    const normalizedScope =
      profile?.dataScope.requirements === 'all'
        ? this.normalizeAiPreviewScope(scope)
        : 'mine';
    return this.listOpsAiPreviewCandidates(
      normalizedLimit,
      normalizedScope,
      currentUser?.id ?? null,
    );
  }

  async confirmAiPreviewCandidate(
    candidateId: string,
    reviewedByUserId: string | null = null,
  ) {
    const result = await this.dataSource.query(
      `
        UPDATE demand_intake_candidates
        SET status = 'confirmed',
            review_status = 'confirmed',
            reviewed_by_user_id = ?,
            reviewed_at = NOW(),
            confirmed_at = COALESCE(confirmed_at, NOW()),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? OR external_candidate_id = ?
      `,
      [reviewedByUserId, candidateId, candidateId],
    );
    return {
      updated: result?.affectedRows ?? result?.[0]?.affectedRows ?? 0,
      source: 'ops_platform',
    };
  }

  async rejectAiPreviewCandidate(
    candidateId: string,
    reviewedByUserId: string | null = null,
  ) {
    const result = await this.dataSource.query(
      `
        UPDATE demand_intake_candidates
        SET status = 'rejected',
            review_status = 'rejected',
            reviewed_by_user_id = ?,
            reviewed_at = NOW(),
            match_reason = COALESCE(match_reason, '人工标记伪需求'),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? OR external_candidate_id = ?
      `,
      [reviewedByUserId, candidateId, candidateId],
    );
    return {
      updated: result?.affectedRows ?? result?.[0]?.affectedRows ?? 0,
      source: 'ops_platform',
    };
  }

  private normalizeAiPreviewScope(scope?: string | null) {
    return ['mine', 'all', 'processed'].includes(String(scope ?? ''))
      ? String(scope)
      : 'mine';
  }

  private async listOpsAiPreviewCandidates(
    limit: number,
    scope: string,
    currentUserId: string | null,
  ) {
    const whereParts = ['c.deleted_at IS NULL'];
    const params: Array<string | number> = [];
    if (scope === 'processed') {
      whereParts.push(
        "COALESCE(c.review_status, c.status, 'pending_owner_review') IN ('confirmed', 'rejected')",
      );
    } else {
      whereParts.push(
        "COALESCE(c.status, 'pending') NOT IN ('confirmed', 'rejected')",
      );
      if (scope === 'mine' && currentUserId) {
        whereParts.push('c.review_owner_user_id = ?');
        params.push(currentUserId);
      }
    }
    params.push(limit);

    const rows = await this.dataSource.query(
      `
        SELECT
          c.source_chat_name AS chat_name,
          c.raw_customer_name AS customer_name,
          c.raw_owner_name AS owner_name,
          c.raw_business_platform AS business_platform,
          c.id AS candidate_id,
          c.external_candidate_id,
          c.external_capture_run_id,
          c.external_source_key,
          c.external_chat_id,
          c.business_category,
          c.secondary_category,
          c.tertiary_category,
          c.start_time,
          c.deadline,
          c.business_name,
          c.demand_title,
          c.demand_content,
          c.confidence,
          c.status,
          COALESCE(c.review_status, 'pending_owner_review') AS review_status,
          c.review_owner_user_id,
          review_owner.display_name AS review_owner_name,
          c.reviewed_by_user_id,
          reviewed_by.display_name AS reviewed_by_name,
          c.reviewed_at,
          c.review_note,
          c.match_suggestion,
          COALESCE(c.matched_customer_code, matched_customer.customer_code) AS matched_customer_code,
          c.matched_customer_id,
          c.matched_contact_context_id,
          c.match_confidence,
          c.match_reason
        FROM demand_intake_candidates c
        LEFT JOIN customers matched_customer
          ON matched_customer.id = c.matched_customer_id
         AND matched_customer.deleted_at IS NULL
        LEFT JOIN users review_owner
          ON review_owner.id = c.review_owner_user_id
        LEFT JOIN users reviewed_by
          ON reviewed_by.id = c.reviewed_by_user_id
        WHERE ${whereParts.join('\n          AND ')}
        ORDER BY c.created_at DESC
        LIMIT ?
      `,
      params,
    );
    return this.attachAiPreviewEvidences(rows);
  }

  private startAiPreviewNotificationScanner() {
    if (process.env.AI_PREVIEW_NOTIFICATION_SCAN_DISABLED === 'true') {
      return;
    }
    const intervalMs = Math.max(
      10000,
      Number(process.env.AI_PREVIEW_NOTIFICATION_SCAN_INTERVAL_MS ?? 60000),
    );
    void this.runAiPreviewNotificationScan();
    this.aiPreviewNotificationTimer = setInterval(() => {
      void this.runAiPreviewNotificationScan();
    }, intervalMs);
    this.aiPreviewNotificationTimer.unref?.();
  }

  private async runAiPreviewNotificationScan() {
    if (this.aiPreviewNotificationRunning) {
      return;
    }
    this.aiPreviewNotificationRunning = true;
    try {
      await this.assignAiPreviewReviewOwners();
      await this.notifyAiPreviewReviewOwners();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`AI preview notification scan failed: ${message}`);
    } finally {
      this.aiPreviewNotificationRunning = false;
    }
  }

  private async assignAiPreviewReviewOwners() {
    await this.dataSource.query(`
      UPDATE demand_intake_candidates
      SET review_status = status,
          reviewed_at = COALESCE(reviewed_at, confirmed_at),
          updated_at = CURRENT_TIMESTAMP
      WHERE deleted_at IS NULL
        AND status IN ('confirmed', 'rejected')
        AND COALESCE(review_status, '') <> status
    `);

    await this.dataSource.query(`
      UPDATE demand_intake_candidates candidate
      JOIN business_category_owner_configs owner_config
        ON owner_config.business_category_code =
          CASE candidate.business_category
            WHEN '设计' THEN 'design'
            WHEN '文案' THEN 'copywriting'
            WHEN '运营' THEN 'operation'
            WHEN '社区' THEN 'community'
            ELSE candidate.business_category
          END
       AND owner_config.status = 'active'
       AND owner_config.owner_user_id IS NOT NULL
      JOIN users owner_user
        ON owner_user.id = owner_config.owner_user_id
       AND owner_user.status = 'active'
       AND owner_user.deleted_at IS NULL
      SET candidate.review_owner_user_id = owner_config.owner_user_id,
          candidate.review_status =
            CASE
              WHEN COALESCE(candidate.review_status, '') IN ('', 'unassigned') THEN 'pending_owner_review'
              ELSE candidate.review_status
            END,
          candidate.updated_at = CURRENT_TIMESTAMP
      WHERE candidate.deleted_at IS NULL
        AND COALESCE(candidate.status, 'pending') NOT IN ('confirmed', 'rejected')
        AND (candidate.review_owner_user_id IS NULL OR candidate.review_owner_user_id = '')
    `);

    await this.dataSource.query(`
      UPDATE demand_intake_candidates candidate
      LEFT JOIN business_category_owner_configs owner_config
        ON owner_config.business_category_code =
          CASE candidate.business_category
            WHEN '设计' THEN 'design'
            WHEN '文案' THEN 'copywriting'
            WHEN '运营' THEN 'operation'
            WHEN '社区' THEN 'community'
            ELSE candidate.business_category
          END
       AND owner_config.status = 'active'
       AND owner_config.owner_user_id IS NOT NULL
      SET candidate.review_status = 'unassigned',
          candidate.updated_at = CURRENT_TIMESTAMP
      WHERE candidate.deleted_at IS NULL
        AND COALESCE(candidate.status, 'pending') NOT IN ('confirmed', 'rejected')
        AND (candidate.review_owner_user_id IS NULL OR candidate.review_owner_user_id = '')
        AND owner_config.owner_user_id IS NULL
        AND COALESCE(candidate.review_status, '') <> 'unassigned'
    `);
  }

  private async notifyAiPreviewReviewOwners() {
    const rows = await this.dataSource.query(
      `
        SELECT
          candidate.id,
          candidate.demand_title AS demandTitle,
          candidate.business_name AS businessName,
          candidate.raw_customer_name AS customerName,
          candidate.raw_business_platform AS businessPlatform,
          candidate.business_category AS businessCategory,
          candidate.confidence,
          candidate.review_owner_user_id AS reviewOwnerUserId
        FROM demand_intake_candidates candidate
        JOIN users owner_user
          ON owner_user.id = candidate.review_owner_user_id
         AND owner_user.status = 'active'
         AND owner_user.deleted_at IS NULL
        LEFT JOIN notification_messages message
          ON message.object_type = 'ai_preview_candidate'
         AND message.object_id = candidate.id
         AND message.recipient_user_id = candidate.review_owner_user_id
         AND message.deleted_at IS NULL
        WHERE candidate.deleted_at IS NULL
          AND COALESCE(candidate.status, 'pending') NOT IN ('confirmed', 'rejected')
          AND candidate.review_owner_user_id IS NOT NULL
          AND COALESCE(candidate.review_status, 'pending_owner_review') = 'pending_owner_review'
          AND message.id IS NULL
        ORDER BY candidate.created_at DESC
        LIMIT 20
      `,
    );

    for (const row of rows) {
      await this.notificationsService.send({
        recipientUserId: row.reviewOwnerUserId,
        title: `AI需求待确认：${row.demandTitle ?? row.businessName ?? '未命名需求'}`,
        content: [
          `需求名称：${row.demandTitle ?? row.businessName ?? '-'}`,
          `客户平台：${[row.customerName, row.businessPlatform].filter(Boolean).join('-') || '-'}`,
          `业务类型：${row.businessCategory ?? '-'}`,
          `识别置信度：${this.previewConfidenceText(row.confidence)}`,
          '请进入工作台确认是否转为正式需求。',
        ].join('\n'),
        objectType: 'ai_preview_candidate',
        objectId: row.id,
        channels: ['in_app', 'feishu_app'],
        actionUrl: this.buildWorkbenchUrl(),
        actionText: '查看并确认',
      });
    }
  }

  private previewConfidenceText(value: unknown) {
    if (value === null || value === undefined || value === '') {
      return '-';
    }
    const numeric = Number(value);
    if (Number.isNaN(numeric)) {
      return String(value);
    }
    return `${Math.round((numeric > 1 ? numeric / 100 : numeric) * 100)}%`;
  }

  private buildWorkbenchUrl() {
    const baseUrl = process.env.APP_PUBLIC_BASE_URL ?? 'http://localhost:3000';
    return baseUrl.replace(/\/$/, '/');
  }

  private async attachAiPreviewEvidences(rows: Array<Record<string, unknown>>) {
    const candidateIds = rows
      .map((row) => row.candidate_id)
      .filter((id): id is string | number => Boolean(id));
    if (!candidateIds.length) return rows;

    const placeholders = candidateIds.map(() => '?').join(', ');
    const evidenceRows = await this.dataSource.query(
      `
        SELECT
          e.candidate_id,
          e.evidence_order,
          e.message_time,
          e.display_time_text,
          e.sender_name,
          e.message_text,
          e.screenshot_path,
          e.evidence_reason
        FROM demand_candidate_evidence e
        WHERE e.candidate_id IN (${placeholders})
        ORDER BY e.candidate_id ASC, e.evidence_order ASC, e.created_at ASC
      `,
      candidateIds,
    );

    const evidenceByCandidateId = new Map<
      string,
      Array<Record<string, unknown>>
    >();
    for (const row of evidenceRows) {
      const key = String(row.candidate_id);
      const current = evidenceByCandidateId.get(key) ?? [];
      current.push(row);
      evidenceByCandidateId.set(key, current);
    }

    return rows.map((row) => ({
      ...row,
      evidences:
        evidenceByCandidateId.get(String(row.candidate_id ?? '')) ?? [],
    }));
  }

  async findOne(id: string) {
    const requirement = await this.requirementsRepository.findOne({
      where: { id },
    });
    if (!requirement) {
      throw new NotFoundException('Requirement not found');
    }
    return requirement;
  }

  async findItems(requirementId: string) {
    return this.requirementItemsRepository.find({
      where: { requirement_id: requirementId },
      order: { created_at: 'ASC' },
    });
  }

  async create(dto: CreateRequirementDto) {
    const customerCode = await this.resolveCustomerCodeInput(
      dto.customerCode,
      dto.customerId,
    );
    const requirement = this.requirementsRepository.create({
      id: randomUUID(),
      requirement_code: await this.nextRequirementCode(),
      project_id: dto.projectId,
      customer_code: customerCode,
      title: dto.title,
      source_type: 'manual',
      source_ref_id: null,
      business_name: null,
      business_platform: null,
      business_category: null,
      secondary_category: null,
      tertiary_category: null,
      status: 'draft',
      priority: 'p3',
      raw_content: dto.rawContent ?? null,
      summary: dto.rawContent ?? null,
    });

    return this.requirementsRepository.save(requirement);
  }

  async createWithTask(dto: CreateRequirementWithTaskDto) {
    const contactContext = dto.contactContextId
      ? await this.resolveContactContext(dto.contactContextId)
      : null;
    const customerCode = contactContext?.customer_code
      ? String(contactContext.customer_code)
      : await this.resolveCustomerCodeInput(dto.customerCode, dto.customerId);

    return this.createRequirementTaskBundle({
      ...dto,
      projectId: dto.projectId,
      customerCode,
      contactContextId: contactContext?.id ?? dto.contactContextId,
      businessName: dto.businessName,
      businessPlatform:
        dto.businessPlatform ?? contactContext?.business_platform ?? null,
      businessCategory: dto.businessCategory ?? null,
      secondaryCategory: dto.secondaryCategory ?? null,
      tertiaryCategory: dto.tertiaryCategory ?? null,
      sourceType: 'manual',
    });
  }

  async aiSplitWithTasks(dto: AiSplitRequirementsDto) {
    const startedAt = Date.now();
    const requirementContent = this.extractRequirementOnlyContent(
      dto.rawContent,
    );
    const splitResult = await this.analyzeRequirementsWithModel({
      ...dto,
      rawContent: requirementContent,
    });
    const suggestions = splitResult.suggestions;
    if (suggestions.length === 0) {
      throw new BadRequestException('File content has no requirement text');
    }
    const sourceSuggestions = this.splitRequirementContent(requirementContent);
    const customers = await this.customersRepository.find({
      where: { status: 'active' },
      order: { customer_code: 'ASC' },
      take: this.defaultListLimit,
    });
    const batchFallbackMatch = this.matchContextByRules(
      requirementContent,
      customers,
    );
    const created: Array<{
      requirement: RequirementEntity;
      item: RequirementItemEntity;
      task: TaskEntity;
      match: {
        customerId: string | null;
        customerName: string | null;
        projectType: string;
        projectTypeLabel: string;
        confidence: number;
        reason: string;
      };
    }> = [];

    for (const suggestion of suggestions) {
      const sourceContext = this.findSourceContextForSuggestion(
        suggestion,
        sourceSuggestions,
      );
      const contextText = [
        suggestion.title,
        suggestion.content,
        sourceContext?.content,
      ]
        .filter(Boolean)
        .join('\n');
      const itemMatch = this.matchContextByRules(contextText, customers);
      const customerId =
        itemMatch.customerId ??
        batchFallbackMatch.customerId ??
        (await this.resolveCustomerCodeInput(dto.customerCode, dto.customerId));
      const projectType =
        itemMatch.customerId || itemMatch.customerLocked
          ? itemMatch.projectType
          : batchFallbackMatch.projectType;
      const project = await this.ensureProjectForAiRequirement({
        customerCode: customerId,
        projectType,
      });
      const title =
        sourceContext && !this.hasCustomerAlias(suggestion.title, customers)
          ? sourceContext.title
          : suggestion.title;
      const content = this.mergeSuggestionContentWithSourceContext(
        suggestion.content,
        sourceContext?.content,
      );
      const match = {
        customerId,
        customerName:
          itemMatch.customerName ??
          batchFallbackMatch.customerName ??
          customers.find((customer) => customer.customer_code === customerId)
            ?.customer_name ??
          null,
        projectType,
        projectTypeLabel: this.projectTypeLabel(projectType),
        confidence: itemMatch.customerId
          ? itemMatch.confidence
          : batchFallbackMatch.confidence,
        reason: itemMatch.customerId
          ? `按本条需求原文匹配：${itemMatch.reason}`
          : `本条未识别明确客户，使用整篇文件匹配：${batchFallbackMatch.reason}`,
      };
      const bundle = await this.createRequirementTaskBundle({
        projectId: project.id,
        customerCode: customerId,
        title,
        rawContent: content,
        priority: dto.priority ?? suggestion.priority,
        estimatedHours: dto.estimatedHours ?? suggestion.estimatedHours,
        sourceType:
          splitResult.mode === 'openai_compatible'
            ? 'ai_model_split'
            : 'ai_file_split',
        match,
      });
      created.push({
        requirement: bundle.requirement,
        item: bundle.item,
        task: bundle.task,
        match,
      });
    }

    const log = this.aiExecutionLogsRepository.create({
      scene_code: 'requirement_file_split',
      project_id: dto.projectId,
      object_type: 'requirement_batch',
      object_id: null,
      input_json: {
        fileName: dto.fileName ?? null,
        rawLength: dto.rawContent.length,
        requirementOnlyLength: requirementContent.length,
      },
      output_json: {
        mode: splitResult.mode,
        count: suggestions.length,
        suggestions: created.map((item) => ({
          title: item.requirement.title,
          content: item.requirement.raw_content,
          match: item.match,
        })),
        error: splitResult.error ?? null,
      },
      model_name: splitResult.modelName,
      status: 'success',
      execution_ms: Date.now() - startedAt,
      error_message: null,
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(log);

    return {
      mode: splitResult.mode,
      aiLogId: log.id,
      count: created.length,
      items: created,
    };
  }

  async aiMatchContext(dto: AiMatchRequirementContextDto) {
    const startedAt = Date.now();
    const requirementContent = this.extractRequirementOnlyContent(
      dto.rawContent,
    );
    const customers = await this.customersRepository.find({
      where: { status: 'active' },
      order: { customer_code: 'ASC' },
      take: 100,
    });
    const ruleMatch = this.matchContextByRules(requirementContent, customers);
    const modelMatch = await this.matchContextWithModel(
      { ...dto, rawContent: requirementContent },
      customers,
    ).catch((error) => ({
      ...ruleMatch,
      mode: 'openai_failed_rule_fallback',
      error: error instanceof Error ? error.message : 'Unknown model error',
    }));
    const match: {
      mode: string;
      customerId: string | null;
      customerName: string | null;
      projectType: string;
      projectTypeLabel: string;
      confidence: number;
      reason: string;
      error?: string | null;
    } = this.mergeContextMatch(ruleMatch, modelMatch);

    const log = this.aiExecutionLogsRepository.create({
      scene_code: 'requirement_context_match',
      project_id: null,
      object_type: 'requirement_file',
      object_id: null,
      input_json: {
        fileName: dto.fileName ?? null,
        rawLength: dto.rawContent.length,
        requirementOnlyLength: requirementContent.length,
      },
      output_json: match,
      model_name:
        match.mode === 'openai_compatible'
          ? process.env.OPENAI_MODEL?.trim()
          : 'local-context-matcher-v1',
      status: 'success',
      execution_ms: Date.now() - startedAt,
      error_message: match.error ?? null,
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(log);

    return {
      ...match,
      aiLogId: log.id,
    };
  }

  async update(id: string, dto: UpdateRequirementDto) {
    const requirement = await this.findOne(id);
    const targetProjectId = dto.projectId ?? requirement.project_id;
    const targetCustomerCode =
      dto.customerCode || dto.customerId
        ? await this.resolveCustomerCodeInput(dto.customerCode, dto.customerId)
        : requirement.customer_code;
    const priority =
      dto.priority !== undefined
        ? this.normalizePriority(dto.priority)
        : requirement.priority;
    const urgencyLevel =
      dto.urgencyLevel !== undefined
        ? this.normalizeUrgencyLevel(dto.urgencyLevel)
        : requirement.urgency_level;

    if (targetProjectId) {
      const project = await this.projectsRepository.findOne({
        where: { id: targetProjectId },
      });
      if (!project) {
        throw new NotFoundException('Project not found');
      }
      if (targetCustomerCode && project.customer_code !== targetCustomerCode) {
        throw new BadRequestException('Project does not belong to customer');
      }
    }

    Object.assign(requirement, {
      title: dto.title ?? requirement.title,
      status: dto.status ?? requirement.status,
      priority,
      urgency_level: urgencyLevel,
      project_id: targetProjectId,
      customer_code: targetCustomerCode,
      business_name: dto.businessName ?? requirement.business_name,
      business_platform: dto.businessPlatform ?? requirement.business_platform,
      business_category: dto.businessCategory ?? requirement.business_category,
      secondary_category:
        dto.secondaryCategory ?? requirement.secondary_category,
      tertiary_category: dto.tertiaryCategory ?? requirement.tertiary_category,
      raw_content: dto.rawContent ?? requirement.raw_content,
      summary: dto.summary ?? requirement.summary,
    });

    const savedRequirement =
      await this.requirementsRepository.save(requirement);

    const items = await this.requirementItemsRepository.find({
      where: { requirement_id: id },
      order: { created_at: 'ASC' },
      take: 1,
    });
    const item = items[0];
    const shouldSyncItem =
      dto.title !== undefined ||
      dto.rawContent !== undefined ||
      dto.priority !== undefined ||
      dto.urgencyLevel !== undefined;
    const shouldSyncTask =
      shouldSyncItem ||
      dto.projectId !== undefined ||
      dto.businessCategory !== undefined;
    if (item && shouldSyncItem) {
      item.item_title = dto.title ?? item.item_title;
      item.item_description = dto.rawContent ?? item.item_description;
      item.priority = priority ?? item.priority;
      item.urgency_level = urgencyLevel ?? item.urgency_level;
      await this.requirementItemsRepository.save(item);
    }

    if (item && shouldSyncTask) {
      const task = await this.tasksRepository.findOne({
        where: { requirement_item_id: item.id },
      });
      if (task) {
        if (dto.projectId && dto.projectId !== task.project_id) {
          task.task_no = await this.nextTaskNo(dto.projectId);
          task.project_id = dto.projectId;
        }
        task.task_name = dto.title ?? task.task_name;
        task.description = dto.rawContent ?? task.description;
        task.priority = priority ?? task.priority;
        task.urgency_level = urgencyLevel ?? task.urgency_level;
        if (dto.businessCategory !== undefined) {
          task.reporter_user_id = await this.resolveRequirementReporterUserId(
            savedRequirement.business_category,
          );
        }
        await this.tasksRepository.save(task);
      }
    }

    return {
      requirement: savedRequirement,
      item: item ?? null,
      task: item
        ? await this.tasksRepository.findOne({
            where: { requirement_item_id: item.id },
          })
        : null,
    };
  }

  async removeBundle(id: string) {
    const result = await this.dataSource.transaction(async (manager) => {
      const requirement = await manager
        .getRepository(RequirementEntity)
        .findOne({ where: { id } });
      if (!requirement) {
        throw new NotFoundException('Requirement not found');
      }
      const items = await manager.getRepository(RequirementItemEntity).find({
        where: { requirement_id: id },
      });
      const itemIds = items.map((item) => item.id);
      const tasks = itemIds.length
        ? await manager.getRepository(TaskEntity).find({
            where: { requirement_item_id: In(itemIds) },
          })
        : [];
      const taskIds = tasks.map((task) => task.id);
      const mappings = itemIds.length
        ? await manager.getRepository(RequirementQuotationMappingEntity).find({
            where: { requirement_item_id: In(itemIds) },
          })
        : [];
      const quotationItemIds = this.uniqueQuotationItemIds(mappings);

      if (taskIds.length > 0) {
        await manager
          .getRepository(TaskResultFileEntity)
          .softDelete({ task_id: In(taskIds) });
        await manager
          .getRepository(TaskDirectoryEntity)
          .softDelete({ task_id: In(taskIds) });
        await manager.getRepository(TaskEntity).softDelete({ id: In(taskIds) });
      }
      if (mappings.length > 0) {
        await manager.getRepository(RequirementQuotationMappingEntity).delete({
          id: In(mappings.map((mapping) => mapping.id)),
        });
      }
      if (itemIds.length > 0) {
        await manager
          .getRepository(RequirementItemEntity)
          .softDelete({ id: In(itemIds) });
      }
      await manager.getRepository(RequirementEntity).softDelete({ id });
      return {
        quotationItemIds,
        deletedItemCount: itemIds.length,
        deletedTaskCount: taskIds.length,
        deletedMappingCount: mappings.length,
      };
    });
    const quotationItemIds = result.quotationItemIds;
    await this.syncQuotationItemMatchStatuses(quotationItemIds);

    return {
      requirementId: id,
      deletedItemCount: result.deletedItemCount,
      deletedTaskCount: result.deletedTaskCount,
      deletedMappingCount: result.deletedMappingCount,
    };
  }

  async parse(id: string) {
    const requirement = await this.findOne(id);
    const output = {
      summary: requirement.summary ?? requirement.title,
      businessGoals: [requirement.title],
      suggestedItems: [
        {
          itemTitle: requirement.title,
          priority: requirement.priority ?? 'p3',
          estimatedHours: 8,
        },
      ],
      suggestedRisk: '请项目经理确认需求边界与报价范围',
    };

    const log = this.aiExecutionLogsRepository.create({
      scene_code: 'requirement_parse',
      project_id: requirement.project_id,
      object_type: 'requirement',
      object_id: requirement.id,
      input_json: {
        requirementId: requirement.id,
        title: requirement.title,
        summary: requirement.summary,
      },
      output_json: output,
      model_name: 'manual-fallback',
      status: 'success',
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(log);

    requirement.status = 'pending_confirm';
    await this.requirementsRepository.save(requirement);

    return {
      aiLogId: log.id,
      structuredResult: output,
    };
  }

  async confirm(id: string) {
    const requirement = await this.findOne(id);
    requirement.status = 'confirmed';
    requirement.confirmed_at = new Date();
    return this.requirementsRepository.save(requirement);
  }

  async createItem(requirementId: string, dto: CreateRequirementItemDto) {
    const requirement = await this.findOne(requirementId);
    const itemNo = await this.nextRequirementItemNo(requirement);

    const item = this.requirementItemsRepository.create({
      id: randomUUID(),
      requirement_id: requirementId,
      parent_item_id: dto.parentItemId ?? null,
      item_no: itemNo,
      item_title: dto.itemTitle,
      item_description: dto.itemDescription ?? null,
      business_goal: dto.businessGoal ?? null,
      acceptance_criteria: dto.acceptanceCriteria ?? null,
      priority: dto.priority ?? 'p3',
      estimated_hours: dto.estimatedHours ?? null,
      status: 'pending_confirm',
      quote_scope_status: 'not_started',
    });

    return this.requirementItemsRepository.save(item);
  }

  async updateItem(itemId: string, dto: UpdateRequirementItemDto) {
    const item = await this.requirementItemsRepository.findOne({
      where: { id: itemId },
    });
    if (!item) {
      throw new NotFoundException('Requirement item not found');
    }

    Object.assign(item, {
      parent_item_id: dto.parentItemId ?? item.parent_item_id,
      item_title: dto.itemTitle ?? item.item_title,
      item_description: dto.itemDescription ?? item.item_description,
      business_goal: dto.businessGoal ?? item.business_goal,
      acceptance_criteria: dto.acceptanceCriteria ?? item.acceptance_criteria,
      priority: dto.priority ?? item.priority,
      estimated_hours: dto.estimatedHours ?? item.estimated_hours,
      status: dto.status ?? item.status,
      quote_scope_status: dto.quoteScopeStatus ?? item.quote_scope_status,
    });

    return this.requirementItemsRepository.save(item);
  }

  async confirmItem(itemId: string) {
    return this.updateItem(itemId, { status: 'confirmed' });
  }

  async obsoleteItem(itemId: string) {
    return this.updateItem(itemId, {
      status: 'obsolete',
      quoteScopeStatus: 'changed',
    });
  }

  async listItems(projectId?: string, requirementId?: string, status?: string) {
    const requirementIds =
      projectId && !requirementId
        ? (
            await this.requirementsRepository.find({
              select: { id: true },
              where: { project_id: projectId },
            })
          ).map((item) => item.id)
        : undefined;

    if (projectId && requirementIds && requirementIds.length === 0) {
      return [];
    }

    const qb = this.requirementItemsRepository.createQueryBuilder('ri');
    if (requirementId) {
      qb.andWhere('ri.requirement_id = :requirementId', { requirementId });
    }
    if (status) {
      qb.andWhere('ri.status = :status', { status });
    }
    if (requirementIds) {
      qb.andWhere('ri.requirement_id IN (:...requirementIds)', {
        requirementIds,
      });
    }
    return qb.orderBy('ri.created_at', 'ASC').getMany();
  }

  private async createRequirementTaskBundle(input: {
    projectId: string;
    customerCode: string;
    title: string;
    rawContent?: string;
    priority?: string;
    urgencyLevel?: string | null;
    estimatedHours?: string;
    plannedStartAt?: string | null;
    plannedEndAt?: string | null;
    contactContextId?: string | null;
    businessName?: string | null;
    businessPlatform?: string | null;
    businessCategory?: string | null;
    secondaryCategory?: string | null;
    tertiaryCategory?: string | null;
    sourceType: string;
    match?: {
      customerId: string | null;
      customerName: string | null;
      projectType: string;
      projectTypeLabel: string;
      confidence: number;
      reason: string;
    };
  }) {
    const code = await this.nextRequirementCode();
    const priority = this.normalizePriority(input.priority);
    const urgencyLevel = this.normalizeUrgencyLevel(input.urgencyLevel);
    const reporterUserId = await this.resolveRequirementReporterUserId(
      input.businessCategory,
    );

    const requirement = await this.requirementsRepository.save(
      this.requirementsRepository.create({
        id: randomUUID(),
        requirement_code: code,
        project_id: input.projectId,
        customer_code: input.customerCode,
        title: input.title,
        source_type: input.sourceType,
        source_ref_id: input.contactContextId ?? null,
        business_name: input.businessName ?? null,
        business_platform: input.businessPlatform ?? null,
        business_category: input.businessCategory ?? null,
        secondary_category: input.secondaryCategory ?? null,
        tertiary_category: input.tertiaryCategory ?? null,
        status: 'draft',
        priority,
        urgency_level: urgencyLevel,
        raw_content: input.rawContent ?? null,
        summary: input.rawContent ?? input.title,
      }),
    );

    const item = await this.requirementItemsRepository.save(
      this.requirementItemsRepository.create({
        id: randomUUID(),
        requirement_id: requirement.id,
        parent_item_id: null,
        item_no: `${requirement.requirement_code}-ITEM-001`,
        item_title: requirement.title,
        item_description: input.rawContent ?? null,
        business_goal: null,
        acceptance_criteria:
          '执行人收到飞书任务通知后登记交付资产；管理者完成验收；系统同步交付记录并纳入统计。',
        priority,
        urgency_level: urgencyLevel,
        estimated_hours: input.estimatedHours ?? '6',
        status: 'confirmed',
        quote_scope_status: 'not_started',
      }),
    );

    const task = await this.tasksRepository.save(
      this.tasksRepository.create({
        id: randomUUID(),
        project_id: requirement.project_id,
        requirement_item_id: item.id,
        task_no: await this.nextTaskNo(requirement.project_id),
        task_name: item.item_title,
        description: item.item_description ?? null,
        status: 'todo',
        priority: item.priority ?? 'p3',
        urgency_level: item.urgency_level ?? urgencyLevel,
        assignee_user_id: null,
        estimated_hours: item.estimated_hours ?? null,
        planned_start_at: input.plannedStartAt
          ? new Date(input.plannedStartAt)
          : null,
        planned_end_at: input.plannedEndAt
          ? new Date(input.plannedEndAt)
          : null,
        reporter_user_id: reporterUserId,
        blocked_reason: null,
        progress_percent: 0,
      }),
    );

    return {
      requirement,
      item,
      task,
      ...(input.match ? { match: input.match } : {}),
    };
  }

  private async nextTaskNo(projectId: string) {
    const rows = await this.tasksRepository
      .createQueryBuilder('task')
      .withDeleted()
      .select('task.task_no', 'taskNo')
      .where('task.project_id = :projectId', { projectId })
      .getRawMany<{ taskNo: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = /^TASK-(\d+)$/.exec(row.taskNo ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `TASK-${String(maxNo + 1).padStart(4, '0')}`;
  }

  private async resolveContactContext(id: string) {
    const groupMappingRows = await this.dataSource.query(
      `
        SELECT
          mapping.id,
          mapping.contact_name,
          NULL AS contact_mobile,
          NULL AS contact_email,
          mapping.customer_code,
          mapping.business_platform,
          mapping.status,
          mapping.remark
        FROM group_contact_mappings mapping
        WHERE mapping.id = ?
          AND mapping.status = 'active'
          AND mapping.deleted_at IS NULL
        LIMIT 1
      `,
      [id],
    );
    let config = groupMappingRows?.[0] ?? null;
    if (!config && (await this.tableExists('contact_context_configs'))) {
      const legacyRows = await this.dataSource.query(
        `
          SELECT
            context.id,
            context.contact_name,
            context.contact_mobile,
            context.contact_email,
            customer.customer_code,
            context.business_platform,
            context.status,
            context.remark
          FROM contact_context_configs context
          JOIN customers customer
            ON customer.id = context.customer_id
           AND customer.deleted_at IS NULL
          WHERE context.id = ?
            AND context.status = 'active'
            AND context.deleted_at IS NULL
          LIMIT 1
        `,
        [id],
      );
      config = legacyRows?.[0] ?? null;
    }
    if (!config) {
      throw new BadRequestException('Contact context config not found');
    }
    return config;
  }

  private async tableExists(tableName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name = ?
      `,
      [tableName],
    );
    return Number(rows?.[0]?.count || 0) > 0;
  }

  private async resolveCustomerCodeInput(
    customerCode?: string,
    legacyCustomerId?: string,
  ) {
    const code = String(customerCode ?? '').trim();
    if (code) {
      await this.ensureCustomerCode(code);
      return code;
    }
    const legacy = String(legacyCustomerId ?? '').trim();
    if (!legacy) {
      throw new BadRequestException('Customer code is required');
    }
    const byCode = await this.customersRepository.findOne({
      where: { customer_code: legacy },
    });
    if (byCode) return legacy;
    const byId = await this.customersRepository.findOne({ where: { id: legacy } });
    if (!byId?.customer_code) {
      throw new BadRequestException('Customer not found');
    }
    return byId.customer_code;
  }

  private async ensureCustomerCode(customerCode: string) {
    const customer = await this.customersRepository.findOne({
      where: { customer_code: customerCode },
    });
    if (!customer) {
      throw new BadRequestException('Customer code not found');
    }
  }

  private async nextRequirementCode() {
    const prefix = `REQ-${this.todayStamp()}-`;
    const rows = await this.requirementsRepository
      .createQueryBuilder('requirement')
      .withDeleted()
      .select('requirement.requirement_code', 'requirementCode')
      .where('requirement.requirement_code LIKE :prefix', {
        prefix: `${prefix}%`,
      })
      .getRawMany<{ requirementCode: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(
        row.requirementCode ?? '',
      );
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}${String(maxNo + 1).padStart(4, '0')}`;
  }

  private async nextRequirementItemNo(requirement: RequirementEntity) {
    const prefix = `${requirement.requirement_code}-ITEM-`;
    const rows = await this.requirementItemsRepository
      .createQueryBuilder('item')
      .withDeleted()
      .select('item.item_no', 'itemNo')
      .where('item.requirement_id = :requirementId', {
        requirementId: requirement.id,
      })
      .getRawMany<{ itemNo: string }>();
    const maxNo = rows.reduce((max, row) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(row.itemNo ?? '');
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    return `${prefix}${String(maxNo + 1).padStart(3, '0')}`;
  }

  private todayStamp() {
    return new Date().toISOString().slice(0, 10).replace(/-/g, '');
  }

  private async ensureProjectForAiRequirement(input: {
    customerCode: string;
    projectType: string;
  }) {
    const existing = await this.projectsRepository.findOne({
      where: {
        customer_code: input.customerCode,
        project_type: input.projectType,
      },
      order: { created_at: 'DESC' },
    });
    if (existing) {
      return existing;
    }

    const [customer, owner] = await Promise.all([
      this.customersRepository.findOne({
        where: { customer_code: input.customerCode },
      }),
      this.usersRepository.findOne({ where: { username: 'demo.pm.v2' } }),
    ]);
    if (!customer) {
      throw new BadRequestException('AI matched customer not found');
    }
    if (!customer.customer_code) {
      throw new BadRequestException('AI matched customer has no code');
    }
    const ownerUser =
      owner ??
      (await this.usersRepository.findOne({
        where: { status: 'active' },
        order: { created_at: 'ASC' },
      }));
    if (!ownerUser) {
      throw new BadRequestException(
        'No active user found for AI project owner',
      );
    }

    const typeLabel = this.projectTypeLabel(input.projectType);
    const count = await this.projectsRepository.count();
    return this.projectsRepository.save(
      this.projectsRepository.create({
        id: randomUUID(),
        project_code: `PRJ-AI-${String(count + 1).padStart(4, '0')}`,
        project_name: `${customer.customer_name}${typeLabel}项目`,
        customer_code: customer.customer_code,
        owner_user_id: ownerUser.id,
        project_type: input.projectType,
        status: 'pending',
        priority: 'p3',
        budget_amount: null,
        planned_end_date: '2026-12-31',
        actual_end_date: null,
        description: `AI文件录入自动创建：${customer.customer_name} / ${typeLabel}`,
      }),
    );
  }

  private async analyzeRequirementsWithModel(dto: AiSplitRequirementsDto) {
    const modelName = process.env.OPENAI_MODEL?.trim();
    if (
      !process.env.OPENAI_BASE_URL?.trim() ||
      !process.env.OPENAI_API_KEY?.trim() ||
      !modelName
    ) {
      return {
        mode: 'rule_fallback',
        modelName: 'local-rule-splitter-v1',
        suggestions: this.splitRequirementContent(dto.rawContent),
      };
    }

    try {
      const suggestions = await this.callOpenAiCompatibleRequirementSplitter(
        dto.rawContent,
        modelName,
      );
      if (suggestions.length === 0) {
        throw new Error('Model returned no requirements');
      }
      return {
        mode: 'openai_compatible',
        modelName,
        suggestions,
      };
    } catch (error) {
      return {
        mode: 'openai_failed_rule_fallback',
        modelName,
        suggestions: this.splitRequirementContent(dto.rawContent),
        error: error instanceof Error ? error.message : 'Unknown model error',
      };
    }
  }

  private async matchContextWithModel(
    dto: AiMatchRequirementContextDto,
    customers: CustomerEntity[],
  ) {
    const modelName = process.env.OPENAI_MODEL?.trim();
    if (
      !process.env.OPENAI_BASE_URL?.trim() ||
      !process.env.OPENAI_API_KEY?.trim() ||
      !modelName
    ) {
      return null;
    }

    const customerOptions = customers.map((customer) => ({
      id: customer.id,
      code: customer.customer_code,
      name: customer.customer_name,
      industry: customer.industry,
    }));
    const prompt = getAiPrompt('requirement.context_match');
    const response = await fetch(this.openAiChatCompletionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: prompt.content,
          },
          {
            role: 'user',
            content: JSON.stringify({
              fileName: dto.fileName ?? null,
              content: dto.rawContent.slice(0, 12000),
              customerOptions,
              projectTypeOptions: this.projectTypes.map((type) => ({
                value: type.value,
                label: type.label,
              })),
            }),
          },
        ],
      }),
    });
    const body = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: string } }>;
    };
    if (!response.ok) {
      throw new Error(
        `OpenAI compatible context match failed: ${response.status} ${body.error?.message ?? ''}`,
      );
    }
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI compatible context match missing content');
    }

    const parsed = this.parseJsonObject(content) as {
      customerId?: string;
      projectType?: string;
      confidence?: number;
      reason?: string;
    };
    const normalized = this.normalizeContextMatch(parsed, customers);
    return {
      ...normalized,
      mode: 'openai_compatible',
    };
  }

  private mergeContextMatch(
    ruleMatch: {
      mode: string;
      customerId: string | null;
      customerName: string | null;
      projectType: string;
      projectTypeLabel: string;
      confidence: number;
      reason: string;
      customerLocked?: boolean;
      error?: string | null;
    },
    modelMatch: {
      mode: string;
      customerId: string | null;
      customerName: string | null;
      projectType: string;
      projectTypeLabel: string;
      confidence: number;
      reason: string;
      error?: string | null;
    } | null,
  ) {
    if (!modelMatch) {
      return ruleMatch;
    }

    if (ruleMatch.customerLocked && ruleMatch.customerId) {
      return {
        ...modelMatch,
        customerId: ruleMatch.customerId,
        customerName: ruleMatch.customerName,
        confidence: Math.max(modelMatch.confidence, ruleMatch.confidence),
        reason: `客户按原文明确名称锁定为${ruleMatch.customerName}；业务大类${modelMatch.reason}`,
      };
    }

    return modelMatch;
  }

  private matchContextByRules(rawContent: string, customers: CustomerEntity[]) {
    const content = rawContent.toLowerCase();
    let bestCustomer: CustomerEntity | null = null;
    let bestScore = 0;
    for (const customer of customers) {
      const names = [
        customer.customer_name,
        customer.customer_code,
        customer.customer_name.replace(/基金|管理|有限|责任|公司/g, ''),
      ]
        .filter(Boolean)
        .map((value) => value!.toLowerCase())
        .filter((value) => value.length >= 2);
      const score = names.reduce(
        (sum, name) => sum + (content.includes(name) ? name.length : 0),
        0,
      );
      if (score > bestScore) {
        bestScore = score;
        bestCustomer = customer;
      }
    }

    const projectType =
      this.projectTypes
        .map((type) => ({
          type,
          score: type.keywords.reduce(
            (sum, keyword) => sum + (rawContent.includes(keyword) ? 1 : 0),
            0,
          ),
        }))
        .sort((a, b) => b.score - a.score)[0]?.type.value ??
      this.projectTypes[0].value;

    return {
      mode: 'rule_fallback',
      customerId:
        bestScore > 0 ? (bestCustomer?.customer_code ?? null) : null,
      customerName:
        bestScore > 0 ? (bestCustomer?.customer_name ?? null) : null,
      projectType,
      projectTypeLabel: this.projectTypeLabel(projectType),
      confidence: bestScore > 0 ? 0.72 : 0.45,
      customerLocked: bestScore > 0,
      reason:
        bestScore > 0
          ? '根据文件内容中的客户名称和项目关键词匹配。'
          : '未识别到明确客户名称，仅根据关键词匹配业务大类。',
    };
  }

  private normalizeContextMatch(
    input: {
      customerId?: string;
      projectType?: string;
      confidence?: number;
      reason?: string;
    },
    customers: CustomerEntity[],
  ) {
    const customer = customers.find(
      (item) => item.customer_code === input.customerId,
    );
    const projectType = this.projectTypes.some(
      (type) => type.value === input.projectType,
    )
      ? input.projectType!
      : this.projectTypes[0].value;

    return {
      customerId: customer?.customer_code ?? null,
      customerName: customer?.customer_name ?? null,
      projectType,
      projectTypeLabel: this.projectTypeLabel(projectType),
      confidence: Number(input.confidence ?? 0.6),
      reason: input.reason ?? '模型根据文件内容匹配客户和业务大类。',
    };
  }

  private async callOpenAiCompatibleRequirementSplitter(
    rawContent: string,
    modelName: string,
  ) {
    const prompt = getAiPrompt('requirement.splitter');
    const response = await fetch(this.openAiChatCompletionsUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: prompt.content,
          },
          {
            role: 'user',
            content: rawContent.slice(0, 20000),
          },
        ],
      }),
    });

    const body = (await response.json()) as {
      error?: { message?: string };
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    if (!response.ok) {
      throw new Error(
        `OpenAI compatible request failed: ${response.status} ${body.error?.message ?? ''}`,
      );
    }

    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI compatible response missing content');
    }

    return this.normalizeModelSuggestions(this.parseJsonObject(content));
  }

  private openAiChatCompletionsUrl() {
    const baseUrl = process.env.OPENAI_BASE_URL!.trim().replace(/\/$/, '');
    return baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl}/chat/completions`;
  }

  private parseJsonObject(content: string) {
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < jsonStart) {
      throw new Error('Model response is not JSON');
    }
    return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1)) as {
      requirements?: Array<{
        title?: string;
        content?: string;
        priority?: string;
        estimatedHours?: string | number;
      }>;
    };
  }

  private normalizeModelSuggestions(input: {
    requirements?: Array<{
      title?: string;
      content?: string;
      priority?: string;
      estimatedHours?: string | number;
    }>;
  }) {
    return (input.requirements ?? [])
      .map((item, index) => {
        const content = String(item.content ?? item.title ?? '').trim();
        return {
          title: this.compactTitle(String(item.title ?? content), index + 1),
          content,
          priority: this.normalizePriority(item.priority),
          estimatedHours: String(item.estimatedHours ?? '6'),
        };
      })
      .filter((item) => item.content.length > 0)
      .slice(0, 30);
  }

  private findSourceContextForSuggestion(
    suggestion: { title: string; content: string },
    sourceSuggestions: Array<{ title: string; content: string }>,
  ) {
    const target = this.normalizeTextForContextMatch(
      `${suggestion.title}\n${suggestion.content}`,
    );
    if (!target) {
      return null;
    }

    let best: { title: string; content: string } | null = null;
    let bestScore = 0;
    for (const source of sourceSuggestions) {
      const sourceText = this.normalizeTextForContextMatch(
        `${source.title}\n${source.content}`,
      );
      const score = this.scoreContextSimilarity(target, sourceText);
      if (score > bestScore) {
        bestScore = score;
        best = source;
      }
    }

    return bestScore >= 6 ? best : null;
  }

  private mergeSuggestionContentWithSourceContext(
    suggestionContent: string,
    sourceContent?: string,
  ) {
    if (!sourceContent) {
      return suggestionContent;
    }
    const suggestionText = this.normalizeTextForContextMatch(suggestionContent);
    const sourceText = this.normalizeTextForContextMatch(sourceContent);
    if (sourceText.includes(suggestionText)) {
      return sourceContent;
    }
    if (suggestionText.includes(sourceText)) {
      return suggestionContent;
    }
    return `${sourceContent}\n${suggestionContent}`;
  }

  private scoreContextSimilarity(target: string, source: string) {
    if (!target || !source) {
      return 0;
    }
    if (source.includes(target)) {
      return 100 + target.length;
    }
    if (target.includes(source)) {
      return 90 + source.length;
    }

    const sourceChars = new Set(source.split(''));
    return [...new Set(target.split(''))].reduce(
      (score, char) => score + (sourceChars.has(char) ? 1 : 0),
      0,
    );
  }

  private normalizeTextForContextMatch(value: string) {
    return value
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-z0-9]+/g, '')
      .trim();
  }

  private hasCustomerAlias(value: string, customers: CustomerEntity[]) {
    const content = value.toLowerCase();
    return customers.some((customer) =>
      [
        customer.customer_name,
        customer.customer_code,
        customer.customer_name.replace(/基金|管理|有限|责任|公司/g, ''),
      ]
        .filter(Boolean)
        .map((item) => item!.toLowerCase())
        .filter((item) => item.length >= 2)
        .some((alias) => content.includes(alias)),
    );
  }

  private splitRequirementContent(rawContent: string) {
    const normalized = this.extractRequirementOnlyContent(rawContent)
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, ' ')
      .trim();
    if (!normalized) {
      return [];
    }

    const explicitBlocks = normalized
      .split(/\n(?=\s*(?:[-*]|[0-9]+[.、)]|[一二三四五六七八九十]+[、.]))/g)
      .map((item) => item.trim())
      .filter(Boolean);
    const paragraphBlocks =
      explicitBlocks.length > 1
        ? explicitBlocks
        : normalized
            .split(/\n{2,}/g)
            .map((item) => item.trim())
            .filter(Boolean);
    const lineBlocks =
      paragraphBlocks.length > 1
        ? paragraphBlocks
        : normalized
            .split(/\n/g)
            .map((item) => item.trim())
            .filter((item) => item.length >= 6);
    const blocks = (lineBlocks.length ? lineBlocks : [normalized]).slice(0, 30);

    return blocks
      .map((block) =>
        block
          .replace(
            /^\s*(?:[-*]|[0-9]+[.、)]|[一二三四五六七八九十]+[、.])\s*/,
            '',
          )
          .trim(),
      )
      .filter((block) => block.length > 0)
      .filter((block) => !this.isNonRequirementBlock(block))
      .map((cleaned, index) => {
        const [firstLine = cleaned] = cleaned.split('\n').filter(Boolean);
        const title = this.compactTitle(firstLine, index + 1);

        return {
          title,
          content: cleaned,
          priority: this.detectPriority(cleaned),
          estimatedHours: '6',
        };
      });
  }

  private extractRequirementOnlyContent(rawContent: string) {
    const normalized = rawContent.replace(/\r\n/g, '\n').replace(/\t/g, ' ');
    const lines = normalized
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const kept: string[] = [];
    let skippingNonRequirementSection = false;
    for (const line of lines) {
      if (this.isRequirementSectionHeading(line)) {
        skippingNonRequirementSection = false;
        continue;
      }
      if (this.isNonRequirementSectionHeading(line)) {
        skippingNonRequirementSection = true;
        continue;
      }
      if (skippingNonRequirementSection) {
        continue;
      }
      if (this.isNonRequirementBlock(line)) {
        continue;
      }
      kept.push(line);
    }

    return kept.join('\n').trim();
  }

  private isRequirementSectionHeading(value: string) {
    return /^(需求|需求部分|客户需求|新增需求|任务需求|制作需求)[:：]?$/.test(
      value.trim(),
    );
  }

  private isNonRequirementSectionHeading(value: string) {
    return /^(确认|确认事项|待确认|跟进|跟进事项|跟进记录|进度|进展|沟通记录|备注|已完成|完成情况)[:：]?$/.test(
      value.trim(),
    );
  }

  private isNonRequirementBlock(value: string) {
    const text = value.replace(/\s+/g, '');
    const demandSignals =
      /需求|需要|请做|制作|输出|出具|撰写|写|生成|设计|整理|更新|提供|补充|做\d*期|word版本|方案|文案|报告|长图|海报|数据|核对/.test(
        text,
      );
    const nonRequirementSignals =
      /确认|待确认|跟进|进度|进展|出了吗|出来了吗|做好了吗|做完|完成了|上午做完|下午出|谁去跟进|安排一下|催一下|辛苦|收到|了解|可以吗|行吗|复核一下|看下/.test(
        text,
      );

    return nonRequirementSignals && !demandSignals;
  }

  private compactTitle(value: string, index: number) {
    const title = value
      .replace(/^需求[:：]\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      return `AI拆分需求-${index}`;
    }
    return title.length > 80 ? `${title.slice(0, 80)}...` : title;
  }

  private detectPriority(value: string) {
    if (/紧急|高优|必须|尽快|本周|今天|明天/.test(value)) {
      return 'p0';
    }
    if (/低优|可选|后续|有空/.test(value)) {
      return 'p4';
    }
    return 'p3';
  }

  private normalizePriority(value?: string) {
    const normalized = String(value ?? '')
      .trim()
      .toLowerCase();
    if (/^p\d+$/.test(normalized)) {
      const index = Math.min(4, Number(normalized.slice(1)));
      return `p${Number.isFinite(index) ? index : 4}`;
    }
    if (normalized === 'high') {
      return 'p0';
    }
    if (normalized === 'medium') {
      return 'p1';
    }
    if (normalized === 'low') {
      return 'p2';
    }
    const detected = this.detectPriority(value ?? '');
    const match = /^p(\d+)$/.exec(detected);
    if (match) {
      return `p${Math.min(4, Number(match[1]))}`;
    }
    return detected;
  }

  private normalizeBusinessCategoryCode(value?: string | null) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
      return null;
    }
    const exact = this.projectTypes.find(
      (type) => type.value === normalized || type.label === normalized,
    );
    if (exact) {
      return exact.value;
    }
    const lower = normalized.toLowerCase();
    if (['design', 'designer'].includes(lower)) {
      return 'design';
    }
    if (['copywriting', 'copy', 'content'].includes(lower)) {
      return 'copywriting';
    }
    if (['operation', 'operations', 'ops'].includes(lower)) {
      return 'operation';
    }
    if (['community'].includes(lower)) {
      return 'community';
    }
    return normalized;
  }

  private businessCategoryName(categoryCode: string) {
    return (
      this.projectTypes.find((type) => type.value === categoryCode)?.label ??
      categoryCode
    );
  }

  private async resolveRequirementReporterUserId(
    businessCategory?: string | null,
  ) {
    const categoryCode = this.normalizeBusinessCategoryCode(businessCategory);
    if (!categoryCode) {
      return null;
    }

    const rows = await this.dataSource.query(
      `
        SELECT owner_user_id AS ownerUserId
        FROM business_category_owner_configs
        WHERE business_category_code = ?
          AND status = 'active'
          AND owner_user_id IS NOT NULL
        LIMIT 1
      `,
      [categoryCode],
    );
    const ownerUserId = rows?.[0]?.ownerUserId;
    if (!ownerUserId) {
      return null;
    }

    return this.resolveBusinessCategoryOwnerReference(ownerUserId, true);
  }

  private async resolveBusinessCategoryOwnerReference(
    ownerReference?: string | null,
    createIfMissing = false,
  ) {
    const reference = String(ownerReference ?? '').trim();
    if (!reference) {
      return null;
    }

    const existing = await this.usersRepository.findOne({
      where: [
        { id: reference, status: 'active' },
        { username: reference, status: 'active' },
        { display_name: reference, status: 'active' },
        { feishu_open_id: reference, status: 'active' },
      ],
    });
    if (existing) {
      return existing.id;
    }
    if (!createIfMissing) {
      return null;
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)) {
      return null;
    }

    const username = `owner-${createHash('sha1')
      .update(reference, 'utf8')
      .digest('hex')
      .slice(0, 16)}`;
    const byUsername = await this.usersRepository.findOne({
      where: { username, status: 'active' },
    });
    if (byUsername) {
      return byUsername.id;
    }

    const user = this.usersRepository.create({
      id: randomUUID(),
      username,
      display_name: reference,
      email: null,
      mobile: null,
      avatar_url: null,
      status: 'active',
      source: 'business_category_owner_config',
      feishu_open_id: null,
    });
    return (await this.usersRepository.save(user)).id;
  }

  private normalizeUrgencyLevel(value?: string | null) {
    const normalized = String(value ?? '').trim();
    const allowed = new Set([
      'important_urgent',
      'important_not_urgent',
      'urgent_not_important',
      'normal',
    ]);
    return allowed.has(normalized) ? normalized : 'important_urgent';
  }

  private async ensureRequirementsSchema() {
    await this.ensureCustomerCodeColumn(
      'projects',
      'idx_projects_customer_id',
      'fk_projects_customer',
      true,
    );
    await this.ensureCustomerCodeColumn(
      'requirements',
      'idx_requirements_customer_id',
      'fk_requirements_customer',
      true,
    );
    await this.addColumnIfMissing(
      'requirements',
      'urgency_level',
      'urgency_level VARCHAR(32) NULL AFTER priority',
    );
    await this.addColumnIfMissing(
      'requirement_items',
      'urgency_level',
      'urgency_level VARCHAR(32) NULL AFTER priority',
    );
    await ensureIndex(
      this.dataSource,
      'requirements',
      'idx_requirements_project_created',
      ['project_id', 'created_at'],
    );
    await ensureIndex(
      this.dataSource,
      'requirements',
      'idx_requirements_customer_created',
      ['customer_code', 'created_at'],
    );
    await ensureIndex(
      this.dataSource,
      'requirements',
      'idx_requirements_code',
      ['requirement_code'],
    );
    await ensureIndex(
      this.dataSource,
      'requirement_items',
      'idx_requirement_items_requirement_created',
      ['requirement_id', 'created_at'],
    );
    await ensureIndex(
      this.dataSource,
      'requirement_items',
      'idx_requirement_items_quote_status',
      ['quote_scope_status', 'created_at'],
    );
    await ensureIndex(
      this.dataSource,
      'requirement_items',
      'idx_requirement_items_item_no',
      ['item_no'],
    );
  }

  private async ensureBusinessCategoryOwnerConfigTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS business_category_owner_configs (
        id CHAR(36) NOT NULL,
        business_category_code VARCHAR(64) NOT NULL,
        business_category_name VARCHAR(64) NOT NULL,
        owner_user_id CHAR(36) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_business_category_owner_user (business_category_code, owner_user_id),
        KEY idx_business_category_owner_user (owner_user_id),
        KEY idx_business_category_owner_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='业务大类负责人配置表'
    `);
    await this.ensureBusinessCategoryOwnerConfigIndexes();

    for (const type of this.projectTypes) {
      await this.dataSource.query(
        `
          INSERT INTO business_category_owner_configs (
            id,
            business_category_code,
            business_category_name,
            owner_user_id,
            status,
            remark
          )
          VALUES (?, ?, ?, NULL, 'active', '按业务大类配置需求负责人')
          ON DUPLICATE KEY UPDATE
            business_category_name = VALUES(business_category_name),
            status = IFNULL(status, VALUES(status))
        `,
        [randomUUID(), type.value, type.label],
      );
    }
  }

  private async normalizeBusinessCategoryOwnerConfigUsers() {
    const rows = await this.dataSource.query(
      `
        SELECT id, owner_user_id AS ownerUserId
        FROM business_category_owner_configs
        WHERE status = 'active'
          AND deleted_at IS NULL
          AND owner_user_id IS NOT NULL
          AND owner_user_id <> ''
      `,
    );
    for (const row of rows) {
      const ownerUserId = await this.resolveBusinessCategoryOwnerReference(
        row.ownerUserId,
        true,
      );
      if (ownerUserId && ownerUserId !== row.ownerUserId) {
        await this.dataSource.query(
          `
            UPDATE business_category_owner_configs
            SET owner_user_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          [ownerUserId, row.id],
        );
      }
    }
  }

  private async backfillTaskReportersFromBusinessCategoryOwners() {
    await this.dataSource.query(`
      UPDATE tasks task
      JOIN requirement_items item ON item.id = task.requirement_item_id
      JOIN requirements requirement ON requirement.id = item.requirement_id
      JOIN business_category_owner_configs owner_config
        ON owner_config.business_category_code = requirement.business_category
       AND owner_config.status = 'active'
       AND owner_config.owner_user_id IS NOT NULL
      JOIN users owner_user
        ON owner_user.id = owner_config.owner_user_id
       AND owner_user.status = 'active'
      SET task.reporter_user_id = owner_config.owner_user_id
      WHERE task.deleted_at IS NULL
        AND item.deleted_at IS NULL
        AND requirement.deleted_at IS NULL
    `);
  }

  private async backfillTaskReportersForBusinessCategory(
    businessCategoryCode: string,
  ) {
    await this.dataSource.query(
      `
        UPDATE tasks task
        JOIN requirement_items item ON item.id = task.requirement_item_id
        JOIN requirements requirement ON requirement.id = item.requirement_id
        JOIN business_category_owner_configs owner_config
          ON owner_config.business_category_code = requirement.business_category
         AND owner_config.status = 'active'
         AND owner_config.owner_user_id IS NOT NULL
        JOIN users owner_user
          ON owner_user.id = owner_config.owner_user_id
         AND owner_user.status = 'active'
        SET task.reporter_user_id = owner_config.owner_user_id
        WHERE requirement.business_category = ?
          AND task.deleted_at IS NULL
          AND item.deleted_at IS NULL
          AND requirement.deleted_at IS NULL
      `,
      [businessCategoryCode],
    );
  }

  private async ensureDemandIntakeTables() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS demand_intake_candidates (
        id CHAR(36) NOT NULL,
        source_app VARCHAR(32) NOT NULL DEFAULT 'crawler',
        external_candidate_id VARCHAR(64) NULL,
        external_capture_run_id VARCHAR(64) NULL,
        external_source_key CHAR(64) NULL,
        external_chat_id VARCHAR(64) NULL,
        source_chat_name VARCHAR(255) NULL,
        raw_customer_name VARCHAR(128) NULL,
        raw_owner_name VARCHAR(255) NULL,
        raw_business_platform VARCHAR(64) NULL,
        business_category VARCHAR(64) NULL,
        secondary_category VARCHAR(64) NULL,
        tertiary_category VARCHAR(64) NULL,
        start_time DATETIME NULL,
        deadline DATETIME NULL,
        business_name VARCHAR(255) NULL,
        demand_title VARCHAR(255) NULL,
        demand_content LONGTEXT NULL,
        confidence DECIMAL(8,4) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        match_suggestion TEXT NULL,
        matched_customer_code VARCHAR(32) NULL,
        matched_customer_id CHAR(36) NULL,
        matched_contact_context_id CHAR(36) NULL,
        matched_business_platform VARCHAR(64) NULL,
        match_confidence DECIMAL(8,4) NULL,
        match_reason VARCHAR(500) NULL,
        review_owner_user_id CHAR(36) NULL,
        review_status VARCHAR(32) NOT NULL DEFAULT 'pending_owner_review',
        reviewed_by_user_id CHAR(36) NULL,
        reviewed_at DATETIME NULL,
        review_note TEXT NULL,
        confirmed_requirement_id CHAR(36) NULL,
        confirmed_task_id CHAR(36) NULL,
        confirmed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_demand_intake_external (source_app, external_candidate_id),
        KEY idx_demand_intake_status_created (status, created_at),
        KEY idx_demand_intake_capture (source_app, external_capture_run_id),
        KEY idx_demand_intake_source_key (source_app, external_source_key),
        KEY idx_demand_intake_external_chat (source_app, external_chat_id),
        KEY idx_demand_intake_matched_contact (matched_contact_context_id),
        KEY idx_demand_intake_review_owner (review_owner_user_id, review_status, created_at),
        KEY idx_demand_intake_confirmed_requirement (confirmed_requirement_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='候选需求接入表'
    `);

    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'demand_content',
      'demand_content LONGTEXT NULL',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'external_capture_run_id',
      'external_capture_run_id VARCHAR(64) NULL',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'external_source_key',
      'external_source_key CHAR(64) NULL',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'matched_customer_code',
      'matched_customer_code VARCHAR(32) NULL AFTER matched_customer_id',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'review_owner_user_id',
      'review_owner_user_id CHAR(36) NULL AFTER match_reason',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'review_status',
      "review_status VARCHAR(32) NOT NULL DEFAULT 'pending_owner_review' AFTER review_owner_user_id",
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'reviewed_by_user_id',
      'reviewed_by_user_id CHAR(36) NULL AFTER review_status',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'reviewed_at',
      'reviewed_at DATETIME NULL AFTER reviewed_by_user_id',
    );
    await this.addColumnIfMissing(
      'demand_intake_candidates',
      'review_note',
      'review_note TEXT NULL AFTER reviewed_at',
    );
    if (await this.columnExists('demand_intake_candidates', 'matched_customer_id')) {
      await this.dataSource.query(`
        UPDATE demand_intake_candidates candidate
        JOIN customers customer
          ON customer.id = candidate.matched_customer_id
         AND customer.deleted_at IS NULL
        SET candidate.matched_customer_code = customer.customer_code
        WHERE (candidate.matched_customer_code IS NULL OR candidate.matched_customer_code = '')
          AND candidate.matched_customer_id IS NOT NULL
          AND customer.customer_code IS NOT NULL
          AND customer.customer_code <> ''
      `);
    }
    await ensureIndex(this.dataSource, 'demand_intake_candidates', 'idx_demand_intake_capture', [
      'source_app',
      'external_capture_run_id',
    ]);
    await ensureIndex(this.dataSource, 'demand_intake_candidates', 'idx_demand_intake_source_key', [
      'source_app',
      'external_source_key',
    ]);
    await ensureIndex(this.dataSource, 'demand_intake_candidates', 'idx_demand_intake_review_owner', [
      'review_owner_user_id',
      'review_status',
      'created_at',
    ]);
    await this.assignAiPreviewReviewOwners();

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS demand_candidate_evidence (
        id CHAR(36) NOT NULL,
        candidate_id CHAR(36) NOT NULL,
        external_evidence_id VARCHAR(64) NULL,
        evidence_order INT NOT NULL DEFAULT 100,
        message_time DATETIME NULL,
        display_time_text VARCHAR(64) NULL,
        sender_name VARCHAR(128) NULL,
        message_text TEXT NULL,
        screenshot_path VARCHAR(500) NULL,
        evidence_reason TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_demand_evidence_external (candidate_id, external_evidence_id),
        KEY idx_demand_evidence_candidate_order (candidate_id, evidence_order),
        KEY idx_demand_evidence_external (external_evidence_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='候选需求证据链表'
    `);
  }

  private async addColumnIfMissing(
    tableName: string,
    columnName: string,
    columnDefinition: string,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName],
    );
    if (Number(rows?.[0]?.count ?? 0) > 0) {
      return;
    }
    await this.dataSource.query(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition}`,
    );
  }

  private async ensureCustomerCodeColumn(
    tableName: string,
    legacyIndexName: string,
    legacyForeignKeyName: string,
    required: boolean,
  ) {
    await this.addColumnIfMissing(
      tableName,
      'customer_code',
      `customer_code VARCHAR(32) NULL AFTER customer_id`,
    );
    if (await this.columnExists(tableName, 'customer_id')) {
      await this.dataSource.query(`
        UPDATE ${tableName} target
        JOIN customers customer
          ON customer.id = target.customer_id
         AND customer.deleted_at IS NULL
        SET target.customer_code = customer.customer_code
        WHERE (target.customer_code IS NULL OR target.customer_code = '')
          AND customer.customer_code IS NOT NULL
          AND customer.customer_code <> ''
      `);
      await this.dropForeignKeyIfExists(tableName, legacyForeignKeyName);
      await this.dropIndexIfExists(tableName, legacyIndexName);
      await this.dropIndexIfExists(tableName, `${legacyIndexName}_created`);
      await this.dropIndexIfExists(tableName, `idx_${tableName}_customer_created`);
      await this.dropColumnIfExists(tableName, 'customer_id');
    }
    if (required) {
      await this.dataSource.query(
        `ALTER TABLE ${tableName} MODIFY customer_code VARCHAR(32) NOT NULL`,
      );
    }
    await ensureIndex(this.dataSource, tableName, `${legacyIndexName}_code`, [
      'customer_code',
    ]);
  }

  private async columnExists(tableName: string, columnName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND column_name = ?
      `,
      [tableName, columnName],
    );
    return Number(rows?.[0]?.count ?? 0) > 0;
  }

  private async dropColumnIfExists(tableName: string, columnName: string) {
    if (!(await this.columnExists(tableName, columnName))) return;
    await this.dataSource.query(
      `ALTER TABLE ${tableName} DROP COLUMN ${columnName}`,
    );
  }

  private async dropIndexIfExists(tableName: string, indexName: string) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = ?
          AND index_name = ?
      `,
      [tableName, indexName],
    );
    if (Number(rows?.[0]?.count ?? 0) === 0) return;
    await this.dataSource.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`);
  }

  private async dropForeignKeyIfExists(
    tableName: string,
    constraintName: string,
  ) {
    const rows = await this.dataSource.query(
      `
        SELECT COUNT(*) AS count
        FROM information_schema.table_constraints
        WHERE constraint_schema = DATABASE()
          AND table_name = ?
          AND constraint_name = ?
          AND constraint_type = 'FOREIGN KEY'
      `,
      [tableName, constraintName],
    );
    if (Number(rows?.[0]?.count ?? 0) === 0) return;
    await this.dataSource.query(
      `ALTER TABLE ${tableName} DROP FOREIGN KEY ${constraintName}`,
    );
  }

  private uniqueQuotationItemIds(
    mappings: RequirementQuotationMappingEntity[],
  ) {
    return Array.from(
      new Set(
        mappings
          .map((mapping) => mapping.quotation_item_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }

  private async syncQuotationItemMatchStatuses(quotationItemIds: string[]) {
    for (const quotationItemId of quotationItemIds) {
      const item = await this.quotationItemsRepository.findOne({
        where: { id: quotationItemId },
      });
      if (!item) {
        continue;
      }
      const mappings = await this.mappingsRepository.find({
        where: { quotation_item_id: quotationItemId },
      });
      const activeMappings = mappings.filter((mapping) =>
        this.isActiveQuoteMapping(mapping),
      );
      if (
        activeMappings.some((mapping) => mapping.mapping_status === 'matched')
      ) {
        item.match_status = 'confirmed';
      } else if (activeMappings.length > 0) {
        item.match_status = 'matched';
      } else {
        item.match_status =
          Number(item.line_amount || 0) > 0 ? 'unmatched' : 'price_missing';
      }
      await this.quotationItemsRepository.save(item);
    }
  }

  private isActiveQuoteMapping(mapping: RequirementQuotationMappingEntity) {
    return !['rejected', 'obsolete'].includes(mapping.mapping_status);
  }

  private resolveQuoteScopeStatus(
    mappings: RequirementQuotationMappingEntity[],
  ) {
    const activeMappings = mappings.filter((mapping) =>
      this.isActiveQuoteMapping(mapping),
    );
    if (activeMappings.length === 0) {
      return 'not_started';
    }
    if (
      activeMappings.some((mapping) => mapping.mapping_status === 'matched')
    ) {
      return 'matched';
    }
    if (
      activeMappings.some(
        (mapping) =>
          mapping.mapping_status === 'pending_confirm' &&
          mapping.quotation_item_id,
      )
    ) {
      return 'pending_confirm';
    }
    if (
      activeMappings.some((mapping) => mapping.mapping_status === 'partial')
    ) {
      return 'partial';
    }
    return 'changed';
  }

  private projectTypeLabel(value: string) {
    return (
      this.projectTypes.find((type) => type.value === value)?.label ?? value
    );
  }
}
