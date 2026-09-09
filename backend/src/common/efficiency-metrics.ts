export const CONTRIBUTION_POINTS_PER_HOUR = 10;

export function contributionPointsFromHours(
  hours: string | number | null | undefined,
) {
  const numericHours = Number(hours ?? 0);
  if (!Number.isFinite(numericHours) || numericHours <= 0) return '0.00';
  return (numericHours * CONTRIBUTION_POINTS_PER_HOUR).toFixed(2);
}
