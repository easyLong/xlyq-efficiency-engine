import {
  createRecipientWorkflowHandoffToken,
  verifyWorkflowHandoffToken,
} from './workflow-handoff-token';

describe('workflow handoff token', () => {
  const secret = 'test-workflow-handoff-secret';

  it('round-trips a Feishu recipient identity', () => {
    const token = createRecipientWorkflowHandoffToken(
      { userId: 'user-1' },
      { nowSeconds: 1_000, ttlSeconds: 300, secret },
    );

    expect(
      verifyWorkflowHandoffToken(token, {
        nowSeconds: 1_100,
        secret,
      }),
    ).toEqual({
      version: 1,
      purpose: 'feishu_recipient',
      userId: 'user-1',
      issuedAt: 1_000,
      expiresAt: 1_300,
    });
  });

  it('rejects modified and expired tokens', () => {
    const token = createRecipientWorkflowHandoffToken(
      { userId: 'user-1' },
      { nowSeconds: 1_000, ttlSeconds: 60, secret },
    );
    expect(() =>
      verifyWorkflowHandoffToken(`${token}x`, {
        nowSeconds: 1_010,
        secret,
      }),
    ).toThrow();
    expect(() =>
      verifyWorkflowHandoffToken(token, {
        nowSeconds: 1_060,
        secret,
      }),
    ).toThrow('Expired');
  });
});
