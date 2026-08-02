import type { vi } from 'vitest';

type JestCompat = Pick<typeof vi,
  | 'advanceTimersByTime'
  | 'clearAllMocks'
  | 'fn'
  | 'spyOn'
  | 'useFakeTimers'
  | 'useRealTimers'
> & {
  mock(request: string, factory?: () => unknown): void;
  doMock(request: string, factory?: () => unknown): void;
  resetModules(): void;
  isolateModules(callback: () => void): void;
};

declare global {
  var jest: JestCompat;
  var afterAll: typeof import('vitest').afterAll;
  var afterEach: typeof import('vitest').afterEach;
  var beforeAll: typeof import('vitest').beforeAll;
  var beforeEach: typeof import('vitest').beforeEach;
  var describe: typeof import('vitest').describe;
  var expect: typeof import('vitest').expect;
  var test: typeof import('vitest').test;
}

export {};
