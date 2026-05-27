import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExecutionLogEntity } from '../common/entities/ai-execution-log.entity';
import { RiskAlertEntity } from '../common/entities/risk-alert.entity';
import { WorklogEntity } from '../common/entities/worklog.entity';
import { ProjectEntity } from '../projects/entities/project.entity';
import { TaskEntity } from '../tasks/entities/task.entity';
import { GenerateWeeklyReportDto } from './dto/generate-weekly-report.dto';
import { UpdateWeeklyReportDto } from './dto/update-weekly-report.dto';
import { WeeklyReportEntity } from './entities/weekly-report.entity';

@Injectable()
export class WeeklyReportsService {
  constructor(
    @InjectRepository(WeeklyReportEntity)
    private readonly weeklyReportsRepository: Repository<WeeklyReportEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectsRepository: Repository<ProjectEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
    @InjectRepository(WorklogEntity)
    private readonly worklogsRepository: Repository<WorklogEntity>,
    @InjectRepository(RiskAlertEntity)
    private readonly riskAlertsRepository: Repository<RiskAlertEntity>,
    @InjectRepository(AiExecutionLogEntity)
    private readonly aiExecutionLogsRepository: Repository<AiExecutionLogEntity>,
  ) {}

  async findAll(projectId?: string, reportWeek?: string, status?: string) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(reportWeek ? { report_week: reportWeek } : {}),
      ...(status ? { status } : {}),
    };
    return this.weeklyReportsRepository.find({
      where,
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  async findOne(reportId: string) {
    const report = await this.weeklyReportsRepository.findOne({ where: { id: reportId } });
    if (!report) {
      throw new NotFoundException('Weekly report not found');
    }
    return report;
  }

  async generate(dto: GenerateWeeklyReportDto) {
    const project = await this.projectsRepository.findOne({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const [tasks, openRisks, worklogRaw] = await Promise.all([
      this.tasksRepository.find({ where: { project_id: dto.projectId } }),
      this.riskAlertsRepository.find({
        where: { project_id: dto.projectId, status: 'open' },
      }),
      this.worklogsRepository
        .createQueryBuilder('w')
        .select('COALESCE(SUM(w.hours), 0)', 'total')
        .where('w.project_id = :projectId', { projectId: dto.projectId })
        .getRawOne<{ total: string }>(),
    ]);

    const completedCount = tasks.filter((task) => task.status === 'completed').length;
    const inProgressCount = tasks.filter(
      (task) => task.status === 'in_progress',
    ).length;
    const totalHours = Number(worklogRaw?.total ?? 0);
    const content = [
      `项目：${project.project_name}`,
      `周次：${dto.reportWeek}`,
      `本周任务概况：已完成 ${completedCount}，进行中 ${inProgressCount}。`,
      `累计工时：${totalHours} 小时。`,
      `风险数量：${openRisks.length}。`,
      openRisks.length
        ? `当前风险：${openRisks.map((item) => item.title).join('；')}`
        : '当前风险：暂无。',
      '下周建议：优先处理风险任务，并同步需求与报价适配差异。',
    ].join('\n');

    const aiLog = this.aiExecutionLogsRepository.create({
      scene_code: 'weekly_report',
      project_id: dto.projectId,
      object_type: 'project',
      object_id: dto.projectId,
      input_json: { projectId: dto.projectId, reportWeek: dto.reportWeek },
      output_json: { content },
      model_name: 'manual-fallback',
      status: 'success',
      created_by: null,
    });
    await this.aiExecutionLogsRepository.save(aiLog);

    let report = await this.weeklyReportsRepository.findOne({
      where: { project_id: dto.projectId, report_week: dto.reportWeek },
    });

    if (!report) {
      report = this.weeklyReportsRepository.create({
        project_id: dto.projectId,
        report_week: dto.reportWeek,
        title: `${project.project_name} 周报 ${dto.reportWeek}`,
        content,
        source: 'ai',
        status: 'draft',
        generated_by_ai_log_id: aiLog.id,
        sent_to_feishu_at: null,
        created_by: null,
      });
    } else {
      report.title = `${project.project_name} 周报 ${dto.reportWeek}`;
      report.content = content;
      report.source = 'ai';
      report.status = 'draft';
      report.generated_by_ai_log_id = aiLog.id;
    }

    return this.weeklyReportsRepository.save(report);
  }

  async update(reportId: string, dto: UpdateWeeklyReportDto) {
    const report = await this.findOne(reportId);
    Object.assign(report, {
      title: dto.title ?? report.title,
      content: dto.content ?? report.content,
      status: dto.status ?? report.status,
    });
    return this.weeklyReportsRepository.save(report);
  }

  async sendFeishu(reportId: string) {
    const report = await this.findOne(reportId);
    report.status = 'sent';
    report.sent_to_feishu_at = new Date();
    return this.weeklyReportsRepository.save(report);
  }
}
