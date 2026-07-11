export function getSettingsLimits(currentUser) {
  const serverLimits = currentUser?.limits || {};

  return {
    apiTokenTtlDays: Number.isFinite(serverLimits.apiTokenTtlDays) ? serverLimits.apiTokenTtlDays : 30
  };
}
