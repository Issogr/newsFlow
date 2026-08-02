interface IntegerEnvOptions {
  clamp?: boolean;
  max?: number;
  min?: number;
  strict?: boolean;
}

interface BooleanEnvOptions {
  invalidFallback?: boolean;
}

function parseIntegerEnv(name: string, fallbackValue: number, options: IntegerEnvOptions = {}) {
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
    const min = typeof options.min === 'number' && Number.isFinite(options.min) ? options.min : value;
    const max = typeof options.max === 'number' && Number.isFinite(options.max) ? options.max : value;
    return Math.max(min, Math.min(value, max));
  }

  if (typeof options.min === 'number' && Number.isFinite(options.min) && value < options.min) {
    return fallback;
  }

  if (typeof options.max === 'number' && Number.isFinite(options.max) && value > options.max) {
    return fallback;
  }

  return value;
}

function parseBooleanEnv(name: string, fallbackValue = false, options: BooleanEnvOptions = {}) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return Boolean(fallbackValue);
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }

  return Object.hasOwn(options, 'invalidFallback')
    ? Boolean(options.invalidFallback)
    : Boolean(fallbackValue);
}

export = {
  parseBooleanEnv,
  parseIntegerEnv,
};
