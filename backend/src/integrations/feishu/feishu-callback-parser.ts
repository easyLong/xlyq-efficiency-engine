export function getCardActionPayload(body: Record<string, unknown>) {
  const event = asRecord(body.event);
  const header = asRecord(body.header);
  const eventType =
    asString(header?.event_type) ??
    asString(body.type) ??
    asString(event?.type);
  const hasAction = Boolean(asRecord(event?.action) ?? asRecord(body.action));
  if (
    eventType !== 'card.action.trigger' &&
    eventType !== 'card_action' &&
    !hasAction
  ) {
    return null;
  }
  return event ?? body;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
