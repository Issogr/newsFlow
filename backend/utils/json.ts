function parseJsonValue<T>(value: unknown, fallback: T): T;
function parseJsonValue(value: unknown): unknown;
function parseJsonValue<T>(value: unknown, fallback: T | null = null): T | unknown {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function parseJsonArray<T = unknown>(value: unknown, fallback: T[] = []): T[] {
  const parsed = parseJsonValue(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

export = {
  parseJsonArray,
  parseJsonValue,
};
