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
});
