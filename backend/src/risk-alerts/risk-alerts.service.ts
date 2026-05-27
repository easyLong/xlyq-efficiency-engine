import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { LessThan, Not, Repository } from 'typeorm';
import { RiskAlertEntity } from '../common/entities/risk-alert.entity';
import { TaskEntity } from '../tasks/entities/task.entity';

@Injectable()
export class RiskAlertsService {
  constructor(
    @InjectRepository(RiskAlertEntity)
    private readonly riskAlertsRepository: Repository<RiskAlertEntity>,
    @InjectRepository(TaskEntity)
    private readonly tasksRepository: Repository<TaskEntity>,
  ) {}

  async findAll(projectId?: string, status?: string, severity?: string, alertType?: string) {
    const where = {
      ...(projectId ? { project_id: projectId } : {}),
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(alertType ? { alert_type: alertType } : {}),
    };
    return this.riskAlertsRepository.find({
      where,
      order: { triggered_at: 'DESC' },
      take: 200,
    });
  }

  async detect(projectId: string) {
    const now = new Date();
    const overdueTasks = await this.tasksRepository.find({
      where: {
        project_id: projectId,
        status: Not('completed'),
        planned_end_at: LessThan(now),
      },
    });
    const blockedTasks = await this.tasksRepository.find({
      where: {
        project_id: projectId,
        status: 'blocked',
      },
    });

    const created: RiskAlertEntity[] = [];
    for (const task of [...overdueTasks, ...blockedTasks]) {
      const alertType = task.status === 'blocked' ? 'blocked' : 'overdue';
      const existing = await this.riskAlertsRepository.findOne({
        where: {
          project_id: projectId,
          task_id: task.id,
          alert_type: alertType,
          status: 'open',
        },
      });
      if (existing) {
        continue;
      }
      const alert = this.riskAlertsRepository.create({
        id: randomUUID(),
        project_id: projectId,
        task_id: task.id,
        requirement_item_id: task.requirement_item_id,
        alert_type: alertType,
        severity: task.status === 'blocked' ? 'high' : 'medium',
        title:
          alertType === 'blocked'
            ? `任务阻塞：${task.task_name}`
            : `任务逾期：${task.task_name}`,
        content:
          alertType === 'blocked'
            ? task.blocked_reason ?? '任务被标记为阻塞'
            : `计划结束时间 ${task.planned_end_at?.toISOString() ?? ''} 已逾期`,
        status: 'open',
        triggered_at: new Date(),
        resolved_at: null,
      });
      created.push(await this.riskAlertsRepository.save(alert));
    }

    return {
      projectId,
      createdCount: created.length,
      alerts: created,
    };
  }

  async acknowledge(alertId: string) {
    const alert = await this.riskAlertsRepository.findOne({ where: { id: alertId } });
    if (!alert) {
      return null;
    }
    alert.status = 'acknowledged';
    return this.riskAlertsRepository.save(alert);
  }

  async resolve(alertId: string) {
    const alert = await this.riskAlertsRepository.findOne({ where: { id: alertId } });
    if (!alert) {
      return null;
    }
    alert.status = 'resolved';
    alert.resolved_at = new Date();
    return this.riskAlertsRepository.save(alert);
  }
}
