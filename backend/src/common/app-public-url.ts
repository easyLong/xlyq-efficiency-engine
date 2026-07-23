import { createRecipientWorkflowHandoffToken } from './workflow-handoff-token';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

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
