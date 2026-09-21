import { vi, type Mock } from 'vitest';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type MockLogger = Record<LogLevel | 'log', Mock>;

function createMockLogger(): MockLogger {
  const methods: Record<LogLevel, Mock> = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  };

  return {
    ...methods,
    log: vi.fn((level: string, ...args: unknown[]) => {
      const method = methods[level as LogLevel] || methods.info;
      return method(...args);
    })
  };
}

export default createMockLogger;
