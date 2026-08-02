const MIN_PRODUCTION_SECRET_LENGTH = 32;

interface IntegerEnvOptions {
  min?: number;
  max?: number;
}

export function parseIntegerEnv(name: string, fallbackValue: number, options: IntegerEnvOptions = {}): number {
  const parsed = parseInt(process.env[name] || String(fallbackValue), 10);
  const fallback = Number(fallbackValue);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (options.min !== undefined && Number.isFinite(options.min) && parsed < options.min) {
    return fallback;
  }

  if (options.max !== undefined && Number.isFinite(options.max) && parsed > options.max) {
    return fallback;
  }

  return parsed;
}

export function readConfiguredSecret(name: string, developmentFallback: string): string {
  const configured = String(process.env[name] || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured) {
    if (isProduction && configured === developmentFallback) {
      throw new Error(`${name} must not use the development default in production.`);
    }
    if (isProduction && configured.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(`${name} must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`);
    }

    return configured;
  }

  if (isProduction) {
    throw new Error(`${name} is required in production.`);
  }

  return developmentFallback;
}
