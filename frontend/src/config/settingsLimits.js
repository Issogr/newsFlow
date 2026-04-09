export const DEFAULT_SETTINGS_LIMITS = Object.freeze({
  articleRetentionHours: { min: 1, max: 24 },
  recentHours: { min: 1, max: 3 }
});

function resolveMaxValue(value, fallback) {
  return Number.isFinite(value) && value >= fallback.min ? value : fallback.max;
}

export function getSettingsLimits(currentUser) {
  const serverLimits = currentUser?.limits || {};

  return {
    articleRetentionHours: {
      min: DEFAULT_SETTINGS_LIMITS.articleRetentionHours.min,
      max: resolveMaxValue(serverLimits.articleRetentionHoursMax, DEFAULT_SETTINGS_LIMITS.articleRetentionHours)
    },
    recentHours: {
      min: DEFAULT_SETTINGS_LIMITS.recentHours.min,
      max: resolveMaxValue(serverLimits.recentHoursMax, DEFAULT_SETTINGS_LIMITS.recentHours)
    },
    apiTokenTtlDays: Number.isFinite(serverLimits.apiTokenTtlDays) ? serverLimits.apiTokenTtlDays : 30
  };
}

export function clampSettingValue(value, limits) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return limits.min;
  }

  return Math.min(limits.max, Math.max(limits.min, Math.floor(normalized)));
}
