import { DimensionsService } from './dimensions.service';

describe('DimensionsService', () => {
  it('validates a multi-select tertiary classification and totals its metrics', async () => {
    const dimensionsRepository = {
      findOne: jest.fn().mockResolvedValue({
        dimension_code: 'design_banner',
      }),
      find: jest.fn().mockResolvedValue([
        {
          dimension_code: 'banner_design',
          dimension_name: 'Banner 新设计',
          estimated_hours: '4.50',
          contribution_points: '8.00',
        },
        {
          dimension_code: 'banner_resize',
          dimension_name: 'Banner 拓展',
          estimated_hours: '1.50',
          contribution_points: '2.00',
        },
      ]),
    };
    const service = new DimensionsService(
      dimensionsRepository as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.resolveTertiarySelection('design', 'Banner', [
        'banner_design',
        'banner_resize',
      ]),
    ).resolves.toEqual({
      codes: ['banner_design', 'banner_resize'],
      names: ['Banner 新设计', 'Banner 拓展'],
      estimatedHours: '6.00',
      contributionPoints: '10.00',
    });
  });
});
