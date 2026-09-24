import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  it('aggregates late duration and Feishu supplement fields', async () => {
    const usersRepository = {
      find: jest.fn().mockResolvedValue([
        {
          display_name: '测试员工',
          center_name: '测试中心',
          status: 'active',
          attendance_exempt: false,
          feishu_open_id: 'open-1',
          feishu_user_id: 'employee-1',
        },
      ]),
      save: jest.fn(),
    };
    const feishuService = {
      resolveFeishuEmployeeId: jest.fn(),
      queryAttendanceTasks: jest.fn().mockResolvedValue([
        {
          day: 20260922,
          user_id: 'employee-1',
          employee_name: '测试员工',
          records: [
            {
              check_in_shift_time: '1790038800',
              check_in_record: { check_time: '1790038920' },
              check_in_result: 'Late',
              check_in_result_supplement: 'CardReplacement',
              check_out_shift_time: '1790071200',
              check_out_result: 'Normal',
              check_out_result_supplement: 'Leave',
            },
          ],
        },
      ]),
    };
    const service = new AttendanceService(
      usersRepository as never,
      feishuService as never,
    );

    const result = await service.getSummary('month');

    expect(usersRepository.find).toHaveBeenCalledTimes(1);
    expect(result.employeeCount).toBe(1);
    expect(result.totals.lateCount).toBe(1);
    expect(result.totals.lateSeconds).toBe(120);
    expect(result.totals.leaveDays).toBe(1);
    expect(result.totals.cardReplacementDays).toBe(1);
    expect(result.lateRecords).toHaveLength(1);
    expect(result.eventRecords.map((item) => item.type)).toEqual(
      expect.arrayContaining(['补卡', '请假']),
    );
  });

  it('does not treat a no-check rest day as a scheduled day', async () => {
    const usersRepository = {
      find: jest.fn().mockResolvedValue([
        {
          display_name: '测试员工',
          center_name: null,
          status: 'active',
          attendance_exempt: false,
          feishu_open_id: 'open-1',
          feishu_user_id: 'employee-1',
        },
      ]),
      save: jest.fn(),
    };
    const feishuService = {
      queryAttendanceTasks: jest.fn().mockResolvedValue([
        {
          day: 20260920,
          user_id: 'employee-1',
          records: [
            {
              check_in_result: 'NoNeedCheck',
              check_out_result: 'NoNeedCheck',
              check_in_result_supplement: 'None',
              check_out_result_supplement: 'None',
            },
          ],
        },
      ]),
    };
    const service = new AttendanceService(
      usersRepository as never,
      feishuService as never,
    );

    const result = await service.getSummary('month');

    expect(result.totals.scheduledDays).toBe(0);
    expect(result.restDays).toBe(1);
  });

  it('queries a custom historical range and counts its final-day missing checkout', async () => {
    const usersRepository = {
      find: jest.fn().mockResolvedValue([
        {
          display_name: '测试员工',
          center_name: null,
          feishu_open_id: 'open-1',
          feishu_user_id: 'employee-1',
        },
      ]),
      save: jest.fn(),
    };
    const feishuService = {
      queryAttendanceTasks: jest.fn().mockResolvedValue([
        {
          day: 20260831,
          user_id: 'employee-1',
          records: [{ check_in_result: 'Normal', check_out_result: 'Lack' }],
        },
      ]),
    };
    const service = new AttendanceService(
      usersRepository as never,
      feishuService as never,
    );

    const result = await service.getSummary(
      'custom',
      '2026-08-01',
      '2026-08-31',
    );

    expect(result.period).toEqual({
      startDate: '2026-08-01',
      endDate: '2026-08-31',
      label: '2026-08-01 至 2026-08-31',
    });
    expect(result.totals.lackCount).toBe(1);
    expect(feishuService.queryAttendanceTasks).toHaveBeenCalledWith({
      employeeIds: ['employee-1'],
      dateFrom: '20260801',
      dateTo: '20260831',
    });
  });

  it('rejects invalid custom dates before querying Feishu', async () => {
    const usersRepository = { find: jest.fn() };
    const service = new AttendanceService(
      usersRepository as never,
      {} as never,
    );

    await expect(
      service.getSummary('custom', '2026-09-30', '2026-09-01'),
    ).rejects.toThrow('开始日期不能晚于结束日期');
    await expect(
      service.getSummary('custom', '2026-02-30', '2026-03-01'),
    ).rejects.toThrow('日期格式无效');
    expect(usersRepository.find).not.toHaveBeenCalled();
  });
});
