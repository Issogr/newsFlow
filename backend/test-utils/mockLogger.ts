import type { Mock } from 'vitest';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type MockLogger = Record<LogLevel | 'log', Mock>;

function createMockLogger(): MockLogger {
  const methods: Record<LogLevel, Mock> = {
    debug: globalThis.jest.fn(),
    info: globalThis.jest.fn(),
    warn: globalThis.jest.fn(),
    error: globalThis.jest.fn()
  };

  return {
    ...methods,
    log: globalThis.jest.fn((level: string, ...args: unknown[]) => {
      const method = methods[level as LogLevel] || methods.info;
      return method(...args);
    })
  };
}

module.exports = createMockLogger;
