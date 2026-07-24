import { createRecipientWorkflowHandoffToken } from './workflow-handoff-token';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    LOOPBACK_HOSTS.has(normalized) ||
    normalized.endsWith('.local') ||
    isPrivateIpv4(normalized) ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export function resolveAppPublicBaseUrl(
  configuredValue: string | null | undefined = process.env.APP_PUBLIC_BASE_URL,
) {
  const configured = String(configuredValue ?? '').trim();
  if (!configured) {
    throw new Error(
      'APP_PUBLIC_BASE_URL is required before sending external links',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error('APP_PUBLIC_BASE_URL must be an absolute HTTP(S) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('APP_PUBLIC_BASE_URL must use HTTP or HTTPS');
  }
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('APP_PUBLIC_BASE_URL cannot use localhost or 127.0.0.1');
  }

  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function isPublicHttpsAppBaseUrl(
  configuredValue: string | null | undefined = process.env.APP_PUBLIC_BASE_URL,
) {
  try {
    const parsed = new URL(resolveAppPublicBaseUrl(configuredValue));
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !isPrivateHostname(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function assertProductionAppPublicBaseUrl(
  nodeEnv: string | null | undefined = process.env.NODE_ENV,
  configuredValue: string | null | undefined = process.env.APP_PUBLIC_BASE_URL,
) {
  if (String(nodeEnv ?? '').toLowerCase() !== 'production') return;
  if (!isPublicHttpsAppBaseUrl(configuredValue)) {
    throw new Error(
      'Production APP_PUBLIC_BASE_URL must be a public HTTPS URL, for example https://efficiency.example.com',
    );
  }
}

export function buildAppPublicUrl(
  pathname: string,
  searchParams: Record<string, string | number | null | undefined> = {},
  configuredValue?: string | null,
) {
  const baseUrl = resolveAppPublicBaseUrl(configuredValue);
  const url = new URL(
    String(pathname ?? '').replace(/^\/+/, ''),
    `${baseUrl}/`,
  );
  Object.entries(searchParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

export function rebaseAppPublicUrl(
  currentUrl: string,
  configuredValue?: string | null,
) {
  const baseUrl = resolveAppPublicBaseUrl(configuredValue);
  const source = new URL(currentUrl, `${baseUrl}/`);
  const target = new URL(source.pathname.replace(/^\/+/, ''), `${baseUrl}/`);
  target.search = source.search;
  target.hash = source.hash;
  return target.toString();
}

export function addWorkflowHandoffToAppUrl(
  currentUrl: string,
  userId: string,
  configuredValue?: string | null,
) {
  const baseUrl = resolveAppPublicBaseUrl(configuredValue);
  const base = new URL(`${baseUrl}/`);
  const source = new URL(currentUrl, base);
  const isCurrentApp =
    source.origin === base.origin ||
    LOOPBACK_HOSTS.has(source.hostname.toLowerCase());
  if (!isCurrentApp) {
    return currentUrl;
  }
  const target = new URL(source.pathname.replace(/^\/+/, ''), base);
  target.search = source.search;
  target.hash = source.hash;
  const fragment = new URLSearchParams(target.hash.replace(/^#/, ''));
  fragment.set('handoff', createRecipientWorkflowHandoffToken({ userId }));
  target.hash = fragment.toString();
  return target.toString();
}
