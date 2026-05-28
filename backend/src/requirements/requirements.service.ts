import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
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
export class RequirementsService {
  private readonly projectTypes = [
    {
      value: 'periodic_report',
      label: '定期报告制作',
      keywords: ['月报', '季报', '年报', '定期报告', '报告制作', '临时报告'],
    },
    {
      value: 'marketing_material',
      label: '营销材料设计',
      keywords: [
        '营销',
        '路演',
        '海报',
        '长图',
        '产品手册',
        '材料设计',
        '文案',
        'word',
        'Word',
        'WORD',
        'word版本',
        '物料',
        '推文',
        '策划',
        '方案',
        '配置圈',
        '用户陪伴',
      ],
    },
    {
      value: 'data_disclosure',
      label: '数据披露与核对',
      keywords: ['数据', '披露', '净值', '持仓', '业绩', '风险指标', '核对'],
    },
    {
      value: 'compliance_content',
      label: '合规内容支持',
      keywords: ['合规', '免责声明', '文案审核', '留痕', '监管'],
    },
    {
      value: 'web_investor_education',
      label: '官网与投教运营',
      keywords: ['官网', '投教', '运营', '专题', '活动页', '内容维护'],
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
  ) {}

  async findAll(projectId?: string) {
    return this.requirementsRepository.find({
      where: projectId ? { project_id: projectId } : {},
      order: { created_at: 'DESC' },
      take: 100,
    });
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
    const code = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, '0')}`;

    const requirement = this.requirementsRepository.create({
      id: randomUUID(),
      requirement_code: code,
      project_id: dto.projectId,
      customer_id: dto.customerId,
      title: dto.title,
      source_type: 'manual',
      status: 'draft',
      priority: 'medium',
      raw_content: dto.rawContent ?? null,
      summary: dto.rawContent ?? null,
    });

    return this.requirementsRepository.save(requirement);
  }

  async createWithTask(dto: CreateRequirementWithTaskDto) {
    return this.createRequirementTaskBundle({
      ...dto,
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
      take: 100,
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
        itemMatch.customerId ?? batchFallbackMatch.customerId ?? dto.customerId;
      const projectType =
        itemMatch.customerId || itemMatch.customerLocked
          ? itemMatch.projectType
          : batchFallbackMatch.projectType;
      const project = await this.ensureProjectForAiRequirement({
        customerId,
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
          customers.find((customer) => customer.id === customerId)
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
        customerId,
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

    Object.assign(requirement, {
      title: dto.title ?? requirement.title,
      status: dto.status ?? requirement.status,
      priority: dto.priority ?? requirement.priority,
      customer_id: dto.customerId ?? requirement.customer_id,
      raw_content: dto.rawContent ?? requirement.raw_content,
      summary: dto.summary ?? requirement.summary,
    });

    const savedRequirement = await this.requirementsRepository.save(
      requirement,
    );

    const items = await this.requirementItemsRepository.find({
      where: { requirement_id: id },
      order: { created_at: 'ASC' },
      take: 1,
    });
    const item = items[0];
    if (item && (dto.title || dto.rawContent || dto.priority)) {
      item.item_title = dto.title ?? item.item_title;
      item.item_description = dto.rawContent ?? item.item_description;
      item.priority = dto.priority ?? item.priority;
      await this.requirementItemsRepository.save(item);

      const task = await this.tasksRepository.findOne({
        where: { requirement_item_id: item.id },
      });
      if (task) {
        task.task_name = dto.title ?? task.task_name;
        task.description = dto.rawContent ?? task.description;
        task.priority = dto.priority ?? task.priority;
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
    await this.findOne(id);
    const items = await this.requirementItemsRepository.find({
      where: { requirement_id: id },
    });
    const itemIds = items.map((item) => item.id);
    const tasks = itemIds.length
      ? await this.tasksRepository.find({
          where: { requirement_item_id: In(itemIds) },
        })
      : [];
    const taskIds = tasks.map((task) => task.id);

    if (taskIds.length > 0) {
      await this.taskResultFilesRepository.softDelete({ task_id: In(taskIds) });
      await this.taskDirectoriesRepository.softDelete({ task_id: In(taskIds) });
      await this.tasksRepository.softDelete({ id: In(taskIds) });
    }
    if (itemIds.length > 0) {
      await this.requirementItemsRepository.softDelete({ id: In(itemIds) });
    }
    await this.requirementsRepository.softDelete({ id });

    return {
      requirementId: id,
      deletedItemCount: itemIds.length,
      deletedTaskCount: taskIds.length,
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
          priority: requirement.priority ?? 'medium',
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
    const count = await this.requirementItemsRepository.count({
      where: { requirement_id: requirementId },
    });
    const itemNo = `${requirement.requirement_code}-ITEM-${String(count + 1).padStart(3, '0')}`;

    const item = this.requirementItemsRepository.create({
      id: randomUUID(),
      requirement_id: requirementId,
      parent_item_id: dto.parentItemId ?? null,
      item_no: itemNo,
      item_title: dto.itemTitle,
      item_description: dto.itemDescription ?? null,
      business_goal: dto.businessGoal ?? null,
      acceptance_criteria: dto.acceptanceCriteria ?? null,
      priority: dto.priority ?? 'medium',
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
    customerId: string;
    title: string;
    rawContent?: string;
    priority?: string;
    estimatedHours?: string;
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
    const code = `REQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(
      Math.random() * 1000,
    )
      .toString()
      .padStart(3, '0')}`;

    const requirement = await this.requirementsRepository.save(
      this.requirementsRepository.create({
        id: randomUUID(),
        requirement_code: code,
        project_id: input.projectId,
        customer_id: input.customerId,
        title: input.title,
        source_type: input.sourceType,
        status: 'draft',
        priority: input.priority ?? 'high',
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
          '员工收到飞书任务消息；点击后进入在线资产表；只填写资产地址；系统可同步资产表并进入统计。',
        priority: input.priority ?? 'high',
        estimated_hours: input.estimatedHours ?? '6',
        status: 'confirmed',
        quote_scope_status: 'not_started',
      }),
    );

    const count = await this.tasksRepository.count({
      where: { project_id: requirement.project_id },
    });
    const task = await this.tasksRepository.save(
      this.tasksRepository.create({
        id: randomUUID(),
        project_id: requirement.project_id,
        requirement_item_id: item.id,
        task_no: `TASK-${String(count + 1).padStart(4, '0')}`,
        task_name: item.item_title,
        description: item.item_description ?? null,
        status: 'todo',
        priority: item.priority ?? 'medium',
        assignee_user_id: null,
        estimated_hours: item.estimated_hours ?? null,
        planned_end_at: null,
        reporter_user_id: null,
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

  private async ensureProjectForAiRequirement(input: {
    customerId: string;
    projectType: string;
  }) {
    const existing = await this.projectsRepository.findOne({
      where: {
        customer_id: input.customerId,
        project_type: input.projectType,
      },
      order: { created_at: 'DESC' },
    });
    if (existing) {
      return existing;
    }

    const [customer, owner] = await Promise.all([
      this.customersRepository.findOne({ where: { id: input.customerId } }),
      this.usersRepository.findOne({ where: { username: 'demo.pm.v2' } }),
    ]);
    if (!customer) {
      throw new BadRequestException('AI matched customer not found');
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
        customer_id: customer.id,
        owner_user_id: ownerUser.id,
        project_type: input.projectType,
        status: 'pending',
        priority: 'high',
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
            content: [
              '你是项目管理系统的需求归类助手。',
              '请从给定客户列表和项目大类列表中，选择最匹配的客户和项目大类。',
              '只能从 options 中选择，不要编造客户或项目类型。',
              '只输出 JSON：{"customerId":"客户id或空字符串","projectType":"项目类型value","confidence":0到1,"reason":"简短原因"}',
            ].join('\n'),
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
        reason: `客户按原文明确名称锁定为${ruleMatch.customerName}；项目大类${modelMatch.reason}`,
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
      customerId: bestScore > 0 ? (bestCustomer?.id ?? null) : null,
      customerName:
        bestScore > 0 ? (bestCustomer?.customer_name ?? null) : null,
      projectType,
      projectTypeLabel: this.projectTypeLabel(projectType),
      confidence: bestScore > 0 ? 0.72 : 0.45,
      customerLocked: bestScore > 0,
      reason:
        bestScore > 0
          ? '根据文件内容中的客户名称和项目关键词匹配。'
          : '未识别到明确客户名称，仅根据关键词匹配项目大类。',
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
    const customer = customers.find((item) => item.id === input.customerId);
    const projectType = this.projectTypes.some(
      (type) => type.value === input.projectType,
    )
      ? input.projectType!
      : this.projectTypes[0].value;

    return {
      customerId: customer?.id ?? null,
      customerName: customer?.customer_name ?? null,
      projectType,
      projectTypeLabel: this.projectTypeLabel(projectType),
      confidence: Number(input.confidence ?? 0.6),
      reason: input.reason ?? '模型根据文件内容匹配客户和项目大类。',
    };
  }

  private async callOpenAiCompatibleRequirementSplitter(
    rawContent: string,
    modelName: string,
  ) {
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
            content: [
              '你是项目管理软件的需求分析助手。',
              '请把用户提供的需求文件内容拆分为可以指派给员工执行的需求任务。',
              '只提取客户真正提出的需求事项，不要提取确认事项、跟进记录、进度反馈、催办、寒暄、负责人安排、已完成说明。',
              '如果一句话只是“这个出了吗”“上午做完”“谁去跟进”“确认一下”“请复核”，不要作为需求输出。',
              '只输出 JSON，不要输出 Markdown。',
              'JSON 格式：{"requirements":[{"title":"不超过80字","content":"完整需求描述","priority":"high|medium|low","estimatedHours":"数字字符串"}]}',
              '拆分原则：一条需求对应一个可执行任务；合并重复项；保留客户原始上下文；最多输出30条。',
            ].join('\n'),
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
      return 'high';
    }
    if (/低优|可选|后续|有空/.test(value)) {
      return 'low';
    }
    return 'medium';
  }

  private normalizePriority(value?: string) {
    if (value === 'high' || value === 'medium' || value === 'low') {
      return value;
    }
    return this.detectPriority(value ?? '');
  }

  private projectTypeLabel(value: string) {
    return (
      this.projectTypes.find((type) => type.value === value)?.label ?? value
    );
  }
}
