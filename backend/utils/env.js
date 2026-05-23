function parseIntegerEnv(name, fallbackValue, options = {}) {
  const rawValue = process.env[name];
  const parsed = options.strict === true
    ? Number(rawValue)
    : parseInt(rawValue || String(fallbackValue), 10);
  const fallback = Number(fallbackValue);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const value = Math.floor(parsed);

  if (options.clamp === true) {
    const min = Number.isFinite(options.min) ? options.min : value;
    const max = Number.isFinite(options.max) ? options.max : value;
    return Math.max(min, Math.min(value, max));
  }

  if (Number.isFinite(options.min) && value < options.min) {
    return fallback;
  }

  if (Number.isFinite(options.max) && value > options.max) {
    return fallback;
  }

  return value;
}

module.exports = {
  parseIntegerEnv,
};
