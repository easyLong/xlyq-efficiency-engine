import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeishuService } from '../integrations/feishu/feishu.service';
import { UserEntity } from '../users/entities/user.entity';

type AttendanceRange = 'month' | 'week';
type AttendanceRecord = {
  check_in_shift_time?: string | number;
  check_out_shift_time?: string | number;
  check_in_result?: string;
  check_out_result?: string;
  check_in_result_supplement?: string;
  check_out_result_supplement?: string;
  check_in_record?: { check_time?: string | number };
  check_out_record?: { check_time?: string | number };
  supplements?: Array<{ supplement_type?: string }>;
};
type AttendanceDay = {
  day?: number | string;
  user_id?: string;
  employee_name?: string;
  records?: AttendanceRecord[];
};

type EmployeeAttendance = {
  userId: string;
  employeeName: string;
  centerName: string;
  scheduledDays: number;
  normalDays: number;
  lateCount: number;
  lateSeconds: number;
  earlyCount: number;
  lackCount: number;
  leaveDays: number;
  travelDays: number;
  goOutDays: number;
  cardReplacementDays: number;
  fieldPunchDays: number;
};

const supplementLabels: Record<string, string> = {
  Leave: '请假',
  Travel: '出差',
  GoOut: '外出',
  CardReplacement: '补卡',
  CardReplacementApplication: '补卡申请',
  ManagerModification: '管理员修改',
  ShiftChange: '换班',
  FieldPunch: '外勤打卡',
};

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly usersRepository: Repository<UserEntity>,
    private readonly feishuService: FeishuService,
  ) {}

  async getSummary(range: AttendanceRange) {
    const period = this.resolvePeriod(range);
    const users = await this.usersRepository.find({
      where: {
        status: 'active',
        attendance_exempt: false,
      },
      order: { display_name: 'ASC' },
    });
    const eligibleUsers = users.filter((user) => Boolean(user.feishu_open_id));
    const identities = await Promise.all(
      eligibleUsers.map(async (user) => ({
        user,
        employeeId:
          user.feishu_user_id ??
          (await this.feishuService.resolveFeishuEmployeeId(
            user.feishu_open_id as string,
          )),
      })),
    );

    const uncached = identities.filter(
      ({ user, employeeId }) => !user.feishu_user_id && employeeId,
    );
    if (uncached.length) {
      await this.usersRepository.save(
        uncached.map(({ user, employeeId }) => {
          user.feishu_user_id = employeeId;
          return user;
        }),
      );
    }

    const rawDays: unknown[] = [];
    for (let index = 0; index < identities.length; index += 50) {
      rawDays.push(
        ...(await this.feishuService.queryAttendanceTasks({
          employeeIds: identities
            .slice(index, index + 50)
            .map((item) => item.employeeId),
          dateFrom: period.startCompact,
          dateTo: period.endCompact,
        })),
      );
    }

    return this.aggregate(
      range,
      period,
      identities.map(({ user, employeeId }) => ({
        employeeId,
        displayName: user.display_name,
        centerName: user.center_name ?? '未设置中心',
      })),
      rawDays as AttendanceDay[],
    );
  }

  private aggregate(
    range: AttendanceRange,
    period: ReturnType<AttendanceService['resolvePeriod']>,
    identities: Array<{
      employeeId: string;
      displayName: string;
      centerName: string;
    }>,
    days: AttendanceDay[],
  ) {
    const identityByEmployeeId = new Map(
      identities.map((item) => [item.employeeId, item]),
    );
    const employeeMap = new Map<string, EmployeeAttendance>();
    for (const identity of identities) {
      employeeMap.set(identity.employeeId, {
        userId: identity.employeeId,
        employeeName: identity.displayName,
        centerName: identity.centerName,
        scheduledDays: 0,
        normalDays: 0,
        lateCount: 0,
        lateSeconds: 0,
        earlyCount: 0,
        lackCount: 0,
        leaveDays: 0,
        travelDays: 0,
        goOutDays: 0,
        cardReplacementDays: 0,
        fieldPunchDays: 0,
      });
    }

    const lateRecords: Array<Record<string, unknown>> = [];
    const eventRecords: Array<Record<string, unknown>> = [];
    let restDays = 0;
    let todoTodayCount = 0;

    for (const day of days) {
      const userId = String(day.user_id ?? '');
      const identity = identityByEmployeeId.get(userId);
      if (!identity) continue;
      const employee = employeeMap.get(userId) as EmployeeAttendance;
      const date = this.formatDay(day.day);
      const isToday = date === period.endDate;
      const records = Array.isArray(day.records) ? day.records : [];
      const isRestDay =
        records.length === 0 ||
        records.every(
          (record) =>
            record.check_in_result === 'NoNeedCheck' &&
            record.check_out_result === 'NoNeedCheck' &&
            (!record.check_in_result_supplement ||
              record.check_in_result_supplement === 'None') &&
            (!record.check_out_result_supplement ||
              record.check_out_result_supplement === 'None'),
        );
      if (isRestDay) {
        restDays += 1;
        continue;
      }
      employee.scheduledDays += 1;
      let dayHasCoreException = false;
      const daySupplements = new Set<string>();

      for (const record of records) {
        if (record.check_in_result === 'Late') {
          const lateSeconds = Math.max(
            0,
            this.toSeconds(record.check_in_record?.check_time) -
              this.toSeconds(record.check_in_shift_time),
          );
          employee.lateCount += 1;
          employee.lateSeconds += lateSeconds;
          dayHasCoreException = true;
          lateRecords.push({
            date,
            employeeName: employee.employeeName,
            centerName: employee.centerName,
            scheduledTime: this.formatClock(record.check_in_shift_time),
            actualTime: this.formatClock(record.check_in_record?.check_time),
            lateSeconds,
          });
        }
        if (record.check_out_result === 'Early' && !isToday) {
          employee.earlyCount += 1;
          dayHasCoreException = true;
          eventRecords.push(
            this.eventRecord(date, employee, '早退', '下班打卡早于排班时间'),
          );
        }
        const lackCount =
          (record.check_in_result === 'Lack' ? 1 : 0) +
          (!isToday && record.check_out_result === 'Lack' ? 1 : 0);
        if (lackCount) {
          employee.lackCount += lackCount;
          dayHasCoreException = true;
          eventRecords.push(
            this.eventRecord(
              date,
              employee,
              '缺卡',
              lackCount > 1 ? '上、下班均缺卡' : '上班或下班缺卡',
            ),
          );
        }
        if (
          isToday &&
          (record.check_in_result === 'Todo' ||
            record.check_out_result === 'Todo')
        ) {
          todoTodayCount += 1;
        }
        for (const supplement of record.supplements ?? []) {
          if (supplement.supplement_type) {
            daySupplements.add(supplement.supplement_type);
          }
        }
        if (record.check_in_result_supplement) {
          daySupplements.add(record.check_in_result_supplement);
        }
        if (record.check_out_result_supplement) {
          daySupplements.add(record.check_out_result_supplement);
        }
      }

      employee.leaveDays += daySupplements.has('Leave') ? 1 : 0;
      employee.travelDays += daySupplements.has('Travel') ? 1 : 0;
      employee.goOutDays += daySupplements.has('GoOut') ? 1 : 0;
      employee.cardReplacementDays +=
        daySupplements.has('CardReplacement') ||
        daySupplements.has('CardReplacementApplication')
          ? 1
          : 0;
      employee.fieldPunchDays += daySupplements.has('FieldPunch') ? 1 : 0;
      for (const type of daySupplements) {
        if (type === 'None') continue;
        eventRecords.push(
          this.eventRecord(
            date,
            employee,
            supplementLabels[type] ?? type,
            '飞书考勤记录',
          ),
        );
      }

      const hasAbsenceOrOuting = ['Leave', 'Travel', 'GoOut'].some((type) =>
        daySupplements.has(type),
      );
      if (!dayHasCoreException && !hasAbsenceOrOuting) employee.normalDays += 1;
    }

    const employees = Array.from(employeeMap.values()).sort(
      (left, right) =>
        right.lateCount - left.lateCount ||
        right.lackCount - left.lackCount ||
        left.employeeName.localeCompare(right.employeeName, 'zh-CN'),
    );
    const totals = employees.reduce(
      (result, employee) => ({
        scheduledDays: result.scheduledDays + employee.scheduledDays,
        normalDays: result.normalDays + employee.normalDays,
        lateCount: result.lateCount + employee.lateCount,
        lateSeconds: result.lateSeconds + employee.lateSeconds,
        earlyCount: result.earlyCount + employee.earlyCount,
        lackCount: result.lackCount + employee.lackCount,
        leaveDays: result.leaveDays + employee.leaveDays,
        travelDays: result.travelDays + employee.travelDays,
        goOutDays: result.goOutDays + employee.goOutDays,
        cardReplacementDays:
          result.cardReplacementDays + employee.cardReplacementDays,
        fieldPunchDays: result.fieldPunchDays + employee.fieldPunchDays,
      }),
      {
        scheduledDays: 0,
        normalDays: 0,
        lateCount: 0,
        lateSeconds: 0,
        earlyCount: 0,
        lackCount: 0,
        leaveDays: 0,
        travelDays: 0,
        goOutDays: 0,
        cardReplacementDays: 0,
        fieldPunchDays: 0,
      },
    );

    return {
      range,
      period: {
        startDate: period.startDate,
        endDate: period.endDate,
        label: `${period.startDate} 至 ${period.endDate}`,
      },
      employeeCount: identities.length,
      restDays,
      todoTodayCount,
      totals,
      employees,
      lateRecords: lateRecords.sort((left, right) =>
        String(right.date).localeCompare(String(left.date)),
      ),
      eventRecords: eventRecords.sort((left, right) =>
        String(right.date).localeCompare(String(left.date)),
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  private eventRecord(
    date: string,
    employee: EmployeeAttendance,
    type: string,
    detail: string,
  ) {
    return {
      date,
      employeeName: employee.employeeName,
      centerName: employee.centerName,
      type,
      detail,
    };
  }

  private resolvePeriod(range: AttendanceRange) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const year = numberPart('year');
    const month = numberPart('month');
    const day = numberPart('day');
    const current = new Date(Date.UTC(year, month - 1, day));
    const start = new Date(current);
    if (range === 'month') {
      start.setUTCDate(1);
    } else {
      const weekDay = current.getUTCDay() || 7;
      start.setUTCDate(current.getUTCDate() - weekDay + 1);
    }
    const startDate = this.formatCalendarDate(start);
    const endDate = this.formatCalendarDate(current);
    return {
      startDate,
      endDate,
      startCompact: startDate.replaceAll('-', ''),
      endCompact: endDate.replaceAll('-', ''),
    };
  }

  private formatCalendarDate(date: Date) {
    return [
      date.getUTCFullYear(),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
  }

  private formatDay(value?: number | string) {
    const normalized = String(value ?? '');
    if (/^\d{8}$/.test(normalized)) {
      return `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6)}`;
    }
    const seconds = Number(value ?? 0);
    if (seconds > 0) {
      const date = new Date(seconds * (seconds < 10_000_000_000 ? 1000 : 1));
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
    }
    return normalized;
  }

  private toSeconds(value?: string | number) {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : numeric;
  }

  private formatClock(value?: string | number) {
    const seconds = this.toSeconds(value);
    if (!seconds) return '-';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(seconds * 1000));
  }
}
