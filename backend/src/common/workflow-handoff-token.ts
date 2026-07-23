import { createHmac, timingSafeEqual } from 'node:crypto';

type WorkflowHandoffPayload = {
  version: 1;
  purpose: 'feishu_recipient';
  userId: string;
  issuedAt: number;
  expiresAt: number;
};

const DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function workflowHandoffSecret(configuredSecret?: string | null) {
  const secret = String(
    configuredSecret ??
      process.env.WORKFLOW_HANDOFF_SECRET ??
      process.env.TASK_ACCESS_TOKEN_SECRET ??
      process.env.FEISHU_APP_SECRET ??
      process.env.APP_SECRET ??
      process.env.DB_PASSWORD ??
      '',
  ).trim();
  if (!secret) {
    throw new Error('A secret is required for workflow handoff links');
  }
  return secret;
}

function sign(encodedPayload: string, configuredSecret?: string | null) {
  return createHmac('sha256', workflowHandoffSecret(configuredSecret))
    .update(encodedPayload)
    .digest('base64url');
}

export function createRecipientWorkflowHandoffToken(
  input: { userId: string },
  options: {
    nowSeconds?: number;
    ttlSeconds?: number;
    secret?: string | null;
  } = {},
) {
  const userId = String(input.userId ?? '').trim();
  if (!userId) {
    throw new Error('A user ID is required for a workflow handoff link');
  }
  const issuedAt = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  const configuredTtl = Number(
    options.ttlSeconds ??
      process.env.WORKFLOW_HANDOFF_TTL_SECONDS ??
      DEFAULT_TTL_SECONDS,
  );
  const ttlSeconds = Number.isFinite(configuredTtl)
    ? Math.max(60, Math.min(Math.floor(configuredTtl), DEFAULT_TTL_SECONDS))
    : DEFAULT_TTL_SECONDS;
  const payload: WorkflowHandoffPayload = {
    version: 1,
    purpose: 'feishu_recipient',
    userId,
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${encodedPayload}.${sign(encodedPayload, options.secret)}`;
}

export function verifyWorkflowHandoffToken(
  token: string,
  options: { nowSeconds?: number; secret?: string | null } = {},
) {
  const [encodedPayload, suppliedSignature, extra] = String(token ?? '').split(
    '.',
  );
  if (!encodedPayload || !suppliedSignature || extra) {
    throw new Error('Invalid workflow handoff token');
  }
  const expectedSignature = sign(encodedPayload, options.secret);
  const supplied = Buffer.from(suppliedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error('Invalid workflow handoff signature');
  }

  let payload: WorkflowHandoffPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as WorkflowHandoffPayload;
  } catch {
    throw new Error('Invalid workflow handoff payload');
  }
  const nowSeconds = Math.floor(options.nowSeconds ?? Date.now() / 1000);
  if (
    payload.version !== 1 ||
    payload.purpose !== 'feishu_recipient' ||
    !String(payload.userId ?? '').trim() ||
    !Number.isFinite(payload.issuedAt) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.issuedAt > nowSeconds + 60 ||
    payload.expiresAt <= nowSeconds ||
    payload.expiresAt - payload.issuedAt > DEFAULT_TTL_SECONDS
  ) {
    throw new Error('Expired or invalid workflow handoff payload');
  }
  return payload;
}
