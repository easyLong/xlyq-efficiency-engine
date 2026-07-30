import { BusinessCalendarService } from './business-calendar.service';

function createService(
  overrides: Array<{ calendar_date: string; is_workday: 0 | 1 }> = [],
) {
  const dataSource = {
    query: jest.fn((_sql: string, params?: string[]) => {
      if (!params?.length) return [];
      const [start, end] = params;
      return overrides.filter(
        (row) => row.calendar_date >= start && row.calendar_date <= end,
      );
    }),
  };
  return new BusinessCalendarService(dataSource as never);
}

describe('BusinessCalendarService', () => {
  it('counts workdays instead of natural days', async () => {
    const service = createService();

    await expect(
      service.workdaysUntil('2026-08-03', '2026-07-31'),
    ).resolves.toBe(1);
  });

  it('moves a weekend deadline to the next workday by default', async () => {
    const service = createService();

    await expect(
      service.workdaysUntil('2026-08-01', '2026-08-01'),
    ).resolves.toBe(1);
  });

  it('uses calendar overrides before weekday defaults', async () => {
    const service = createService([
      { calendar_date: '2026-08-01', is_workday: 1 },
    ]);

    await expect(
      service.workdaysUntil('2026-08-01', '2026-08-01'),
    ).resolves.toBe(0);
  });

  it('marks overdue only after the deadline workday has passed', async () => {
    const service = createService();

    await expect(service.isOverdue('2026-07-31', '2026-07-31')).resolves.toBe(
      false,
    );
    await expect(service.isOverdue('2026-07-31', '2026-08-03')).resolves.toBe(
      true,
    );
  });
});
