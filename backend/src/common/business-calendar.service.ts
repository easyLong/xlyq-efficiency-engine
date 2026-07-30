import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

type CalendarOverride = {
  calendar_date: string | Date;
  is_workday: 0 | 1 | boolean;
};

@Injectable()
export class BusinessCalendarService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    await this.ensureBusinessCalendarTable();
  }

  async isWorkday(value: Date | string | null | undefined) {
    const day = this.startOfLocalDay(value);
    if (!day) return false;
    const overrides = await this.loadOverrides(day, day);
    return this.isWorkdayWithOverrides(day, overrides);
  }

  async effectiveDeadlineDay(value: Date | string | null | undefined) {
    const day = this.startOfLocalDay(value);
    if (!day) return null;
    const searchEnd = this.addDays(day, 14);
    const overrides = await this.loadOverrides(day, searchEnd);
    let cursor = day;
    for (let index = 0; index <= 14; index += 1) {
      if (this.isWorkdayWithOverrides(cursor, overrides)) {
        return cursor;
      }
      cursor = this.addDays(cursor, 1);
    }
    return day;
  }

  async workdaysUntil(
    deadline: Date | string | null | undefined,
    from: Date | string = new Date(),
  ) {
    const fromDay = this.startOfLocalDay(from);
    const dueDay = await this.effectiveDeadlineDay(deadline);
    if (!fromDay || !dueDay) return null;
    if (this.sameDay(fromDay, dueDay)) return 0;

    const start = dueDay < fromDay ? dueDay : fromDay;
    const end = dueDay < fromDay ? fromDay : dueDay;
    const overrides = await this.loadOverrides(start, end);
    let count = 0;
    let cursor = this.addDays(start, 1);
    while (cursor <= end) {
      if (this.isWorkdayWithOverrides(cursor, overrides)) {
        count += 1;
      }
      cursor = this.addDays(cursor, 1);
    }
    return dueDay < fromDay ? -count : count;
  }

  async isOverdue(
    deadline: Date | string | null | undefined,
    now: Date | string = new Date(),
  ) {
    const remaining = await this.workdaysUntil(deadline, now);
    return remaining !== null && remaining < 0;
  }

  async isDueWithinWorkdays(
    deadline: Date | string | null | undefined,
    workdaysAhead: number,
    now: Date | string = new Date(),
  ) {
    const remaining = await this.workdaysUntil(deadline, now);
    return (
      remaining !== null &&
      remaining >= 0 &&
      remaining <= Math.max(0, Math.floor(workdaysAhead))
    );
  }

  async dueSearchEnd(workdaysAhead: number, from: Date | string = new Date()) {
    const fromDay = this.startOfLocalDay(from) ?? new Date();
    const naturalWindow = Math.max(14, Math.floor(workdaysAhead) * 3 + 14);
    return this.addDays(fromDay, naturalWindow);
  }

  async workdayRange(
    startValue: Date | string,
    endValue: Date | string,
  ): Promise<Array<{ date: string; isWorkday: boolean }>> {
    const start = this.startOfLocalDay(startValue);
    const end = this.startOfLocalDay(endValue);
    if (!start || !end) return [];
    const [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
    const overrides = await this.loadOverrides(rangeStart, rangeEnd);
    const days: Array<{ date: string; isWorkday: boolean }> = [];
    let cursor = rangeStart;
    while (cursor <= rangeEnd) {
      days.push({
        date: this.toDateKey(cursor),
        isWorkday: this.isWorkdayWithOverrides(cursor, overrides),
      });
      cursor = this.addDays(cursor, 1);
    }
    return days;
  }

  startOfLocalDay(value: Date | string | null | undefined = new Date()) {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return new Date(year, month - 1, day);
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  toDateKey(value: Date | string | null | undefined) {
    const day = this.startOfLocalDay(value);
    if (!day) return '';
    return [
      day.getFullYear(),
      String(day.getMonth() + 1).padStart(2, '0'),
      String(day.getDate()).padStart(2, '0'),
    ].join('-');
  }

  private async loadOverrides(start: Date, end: Date) {
    const rows: CalendarOverride[] = await this.dataSource.query(
      `
        SELECT calendar_date, is_workday
        FROM business_calendar
        WHERE deleted_at IS NULL
          AND calendar_date BETWEEN ? AND ?
      `,
      [this.toDateKey(start), this.toDateKey(end)],
    );
    return new Map(
      rows.map((row) => [
        this.toDateKey(row.calendar_date),
        row.is_workday === true || Number(row.is_workday) === 1,
      ]),
    );
  }

  private isWorkdayWithOverrides(day: Date, overrides: Map<string, boolean>) {
    const key = this.toDateKey(day);
    if (overrides.has(key)) {
      return Boolean(overrides.get(key));
    }
    const weekday = day.getDay();
    return weekday >= 1 && weekday <= 5;
  }

  private addDays(day: Date, days: number) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);
  }

  private sameDay(left: Date, right: Date) {
    return this.toDateKey(left) === this.toDateKey(right);
  }

  private async ensureBusinessCalendarTable() {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS business_calendar (
        calendar_date DATE NOT NULL PRIMARY KEY,
        is_workday TINYINT(1) NOT NULL,
        holiday_name VARCHAR(128) NULL,
        source VARCHAR(64) NULL,
        remark VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        KEY idx_business_calendar_workday (is_workday),
        KEY idx_business_calendar_deleted (deleted_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='workday calendar'
    `);
  }
}
