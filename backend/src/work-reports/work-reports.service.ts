import {
  BadRequestException,
  Injectable,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildAccessProfile } from '../common/access-control';
import { buildAppPublicUrl } from '../common/app-public-url';
import { NotificationsService } from '../notifications/notifications.service';
import { UserEntity } from '../users/entities/user.entity';
import { WorkflowConfigsService } from '../workflow-configs/workflow-configs.service';
import { CreateWorkReportDto } from './dto/create-work-report.dto';

const WORK_REPORT_CATEGORIES = [
  {
    code: 'customer_operation',
    name: '客户经营',
    secondaries: ['客户管理', '需求与交付'],
  },
  {
    code: 'internal_management',
    name: '内部管理',
    secondaries: ['日常管理', '内部协同', '流程建设'],
  },
] as const;

@Injectable()
export class WorkReportsService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
    private readonly workflowConfigsService: WorkflowConfigsService,
  ) {}

  async onModuleInit() {
    await this.ensureSchema();
  }

  async getConfig() {
    const recipientIds =
      await this.workflowConfigsService.findGlobalMemberIds('report_recipient');
    const recipients = recipientIds.length
      ? await this.dataSource.query(
          `SELECT id, display_name AS displayName, avatar_url AS avatarUrl
           FROM users WHERE id IN (?) AND status = 'active' AND deleted_at IS NULL
           ORDER BY display_name`,
          [recipientIds],
        )
      : [];
    return {
      categories: WORK_REPORT_CATEGORIES.map((item) => ({
        code: item.code,
        name: item.name,
        secondaries: [...item.secondaries],
      })),
      recipients,
    };
  }

  async findAll(user: UserEntity | null, scope = 'all') {
    if (!user) throw new UnauthorizedException('请先登录');
    const profile = await buildAccessProfile(this.dataSource, user);
    const normalizedScope = ['all', 'mine', 'received'].includes(scope)
      ? scope
      : 'all';
    const params: string[] = [];
    let where = 'report.deleted_at IS NULL';
    if (normalizedScope === 'mine') {
      where += ' AND report.reporter_user_id = ?';
      params.push(user.id);
    } else if (normalizedScope === 'received') {
      where += ` AND EXISTS (
        SELECT 1 FROM work_report_recipients visible_recipient
        WHERE visible_recipient.report_id = report.id
          AND visible_recipient.recipient_user_id = ?
          AND visible_recipient.deleted_at IS NULL
      )`;
      params.push(user.id);
    } else if (!profile.isAdmin) {
      where += ` AND (
        report.reporter_user_id = ? OR EXISTS (
          SELECT 1 FROM work_report_recipients visible_recipient
          WHERE visible_recipient.report_id = report.id
            AND visible_recipient.recipient_user_id = ?
            AND visible_recipient.deleted_at IS NULL
        )
      )`;
      params.push(user.id, user.id);
    }
    return this.dataSource.query(
      `SELECT
         report.id,
         report.report_no AS reportNo,
         report.business_category_code AS businessCategory,
         report.business_category_name AS businessCategoryName,
         report.secondary_category AS secondaryCategory,
         report.title,
         report.content,
         report.reporter_user_id AS reporterUserId,
         reporter.display_name AS reporterName,
         report.status,
         report.submitted_at AS submittedAt,
         report.created_at AS createdAt,
         (
           SELECT GROUP_CONCAT(DISTINCT recipient_user.display_name ORDER BY recipient_user.display_name SEPARATOR '、')
           FROM work_report_recipients recipient
           JOIN users recipient_user ON recipient_user.id = recipient.recipient_user_id
           WHERE recipient.report_id = report.id AND recipient.deleted_at IS NULL
         ) AS recipientNames
       FROM work_reports report
       JOIN users reporter ON reporter.id = report.reporter_user_id
       WHERE ${where}
       ORDER BY report.submitted_at DESC, report.created_at DESC
       LIMIT 200`,
      params,
    );
  }

  async create(dto: CreateWorkReportDto, reporter: UserEntity | null) {
    if (!reporter) throw new UnauthorizedException('请先登录');
    const category = WORK_REPORT_CATEGORIES.find(
      (item) => item.code === dto.businessCategory,
    );
    const secondary = String(dto.secondaryCategory ?? '').trim();
    if (
      !category ||
      !(category.secondaries as readonly string[]).includes(secondary)
    ) {
      throw new BadRequestException('内部管理分类无效');
    }
    const recipientIds = (
      await this.workflowConfigsService.findGlobalMemberIds('report_recipient')
    ).filter((userId) => userId !== reporter.id);
    if (!recipientIds.length) {
      throw new BadRequestException('尚未配置内部管理接收人，请联系管理员');
    }
    const id = randomUUID();
    const reportNo = this.makeReportNo();
    const title = dto.title.trim();
    const content = dto.content.trim();
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO work_reports (
          id, report_no, business_category_code, business_category_name,
          secondary_category, title, content, reporter_user_id, status, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', CURRENT_TIMESTAMP)`,
        [
          id,
          reportNo,
          category.code,
          category.name,
          secondary,
          title,
          content,
          reporter.id,
        ],
      );
      for (const recipientId of recipientIds) {
        await manager.query(
          `INSERT INTO work_report_recipients (
            id, report_id, recipient_user_id, recipient_type, delivery_status
          ) VALUES (?, ?, ?, 'cc', 'pending')`,
          [randomUUID(), id, recipientId],
        );
      }
    });

    let actionUrl: string | undefined;
    try {
      actionUrl =
        buildAppPublicUrl('', {}, undefined) +
        '#view=requirements&requirementView=reports';
    } catch {
      actionUrl = undefined;
    }
    await Promise.all(
      recipientIds.map(async (recipientId) => {
        const notificationTitle = `内部管理：${title}`.slice(0, 128);
        const notificationContent =
          `${reporter.display_name} 提交了内部管理内容\n分类：${category.name} / ${secondary}\n内容：${content}`.slice(
            0,
            2000,
          );
        try {
          const message = await this.notificationsService.send(
            {
              recipientUserId: recipientId,
              title: notificationTitle,
              content: notificationContent,
              objectType: 'work_report',
              objectId: id,
              channels: ['in_app', 'feishu_app'],
              actionUrl,
              actionText: '查看汇报',
            },
            { idempotencyKey: `work-report:${id}:${recipientId}` },
          );
          await this.dataSource.query(
            `UPDATE work_report_recipients
             SET delivery_status = ?, notification_id = ?, delivered_at = ?, updated_at = CURRENT_TIMESTAMP
             WHERE report_id = ? AND recipient_user_id = ? AND deleted_at IS NULL`,
            [
              message.status,
              message.id,
              message.sent_at ?? null,
              id,
              recipientId,
            ],
          );
        } catch {
          await this.dataSource.query(
            `UPDATE work_report_recipients
             SET delivery_status = 'failed', updated_at = CURRENT_TIMESTAMP
             WHERE report_id = ? AND recipient_user_id = ? AND deleted_at IS NULL`,
            [id, recipientId],
          );
        }
      }),
    );
    const rows = await this.findAll(reporter, 'mine');
    return (
      rows.find((row: { id: string }) => row.id === id) ?? { id, reportNo }
    );
  }

  private makeReportNo() {
    const date = new Date();
    const day = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('');
    return `WR-${day}-${randomUUID().slice(0, 6).toUpperCase()}`;
  }

  private async ensureSchema() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS work_reports (
        id CHAR(36) NOT NULL,
        report_no VARCHAR(32) NOT NULL,
        business_category_code VARCHAR(64) NOT NULL,
        business_category_name VARCHAR(64) NOT NULL,
        secondary_category VARCHAR(64) NOT NULL,
        title VARCHAR(128) NOT NULL,
        content TEXT NOT NULL,
        reporter_user_id CHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'submitted',
        submitted_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_work_reports_no (report_no),
        KEY idx_work_reports_reporter (reporter_user_id, submitted_at),
        KEY idx_work_reports_category (business_category_code, secondary_category),
        KEY idx_work_reports_status (status, submitted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工内部管理'
    `);
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS work_report_recipients (
        id CHAR(36) NOT NULL,
        report_id CHAR(36) NOT NULL,
        recipient_user_id CHAR(36) NOT NULL,
        recipient_type VARCHAR(16) NOT NULL DEFAULT 'cc',
        delivery_status VARCHAR(32) NOT NULL DEFAULT 'pending',
        notification_id CHAR(36) NULL,
        delivered_at DATETIME NULL,
        read_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uk_work_report_recipient (report_id, recipient_user_id),
        KEY idx_work_report_recipient_user (recipient_user_id, created_at),
        KEY idx_work_report_recipient_report (report_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内部管理抄送接收人'
    `);
  }
}
