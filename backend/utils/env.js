function parseIntegerEnv(name, fallbackValue, options = {}) {
  const parsed = parseInt(process.env[name] || String(fallbackValue), 10);
  const fallback = Number(fallbackValue);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (Number.isFinite(options.min) && parsed < options.min) {
    return fallback;
  }

  if (Number.isFinite(options.max) && parsed > options.max) {
    return fallback;
  }

  return parsed;
}

module.exports = {
  parseIntegerEnv,
};
