import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

interface CommonJsParentModule {
  id: string;
  filename: string;
  paths: string[];
}

type ModuleParent = NodeJS.Module | CommonJsParentModule | null | undefined;
type ModuleLoad = (
  this: ModuleInternals,
  request: string,
  parent: ModuleParent,
  isMain: boolean
) => unknown;
type ModuleResolveFilename = (
  this: ModuleInternals,
  request: string,
  parent: ModuleParent
) => string;

interface ModuleInternals {
  _load: ModuleLoad;
  _nodeModulePaths(directory: string): string[];
  _resolveFilename: ModuleResolveFilename;
}

type MockFactory = (() => unknown) | undefined;
type MockImplementation = (this: unknown, ...args: unknown[]) => unknown;

interface CompatibilityState {
  mockFactories: Map<string, MockFactory>;
  mockInstances: Map<string, unknown>;
  originalLoad: ModuleLoad;
  originalResolveFilename: ModuleResolveFilename;
  patchedLoad?: ModuleLoad;
}

type JestCompatibility = Pick<typeof vi,
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
  var __NEWSFLOW_VITEST_JEST_COMPAT__: CompatibilityState | undefined;
  var jest: JestCompatibility;
}

const moduleInternals = Module as typeof Module & ModuleInternals;
const require = Module.createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

const state = globalThis.__NEWSFLOW_VITEST_JEST_COMPAT__ || {
  mockFactories: new Map<string, MockFactory>(),
  mockInstances: new Map<string, unknown>(),
  originalLoad: moduleInternals._load,
  originalResolveFilename: moduleInternals._resolveFilename
};

globalThis.__NEWSFLOW_VITEST_JEST_COMPAT__ = state;

function createParentModule(filename: string): CommonJsParentModule {
  return {
    id: filename,
    filename,
    paths: moduleInternals._nodeModulePaths(path.dirname(filename))
  };
}

function parseStackFilename(line: string): string | undefined {
  const match = line.match(/\((.*):(\d+):(\d+)\)$/) || line.match(/at (.*):(\d+):(\d+)$/);
  return match?.[1];
}

function getCallerFilename(): string {
  const stack = new Error().stack || '';
  const stackLines = stack.split('\n').slice(2);

  for (const line of stackLines) {
    const filename = parseStackFilename(line);
    if (!filename || filename === __filename || filename.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }

    return filename;
  }

  return path.join(process.cwd(), '__vitest_test__.ts');
}

function resolveRequest(request: string, parent: ModuleParent): string {
  try {
    return state.originalResolveFilename.call(moduleInternals, request, parent);
  } catch {
    return request;
  }
}

function resolveRequestFromCaller(request: string): string {
  return resolveRequest(request, createParentModule(getCallerFilename()));
}

function registerMock(request: string, factory?: () => unknown): void {
  const resolvedRequest = resolveRequestFromCaller(request);
  state.mockFactories.set(resolvedRequest, factory);
  state.mockInstances.delete(resolvedRequest);
}

function clearProjectRequireCache(): void {
  const projectRoot = path.resolve(process.cwd());
  const projectRootPrefix = `${projectRoot}${path.sep}`;

  for (const filename of Object.keys(require.cache)) {
    if ((filename === projectRoot || filename.startsWith(projectRootPrefix)) && !filename.includes(`${path.sep}node_modules${path.sep}`)) {
      delete require.cache[filename];
    }
  }

  state.mockInstances.clear();
}

function createMockFunction(implementation?: MockImplementation) {
  function wrapImplementation(nextImplementation: undefined): undefined;
  function wrapImplementation(nextImplementation: MockImplementation): MockImplementation;
  function wrapImplementation(nextImplementation: MockImplementation | undefined): MockImplementation | undefined;
  function wrapImplementation(nextImplementation: MockImplementation | undefined): MockImplementation | undefined {
    if (nextImplementation === undefined) {
      return undefined;
    }

    return function mockImplementation(this: unknown, ...args: unknown[]): unknown {
      return nextImplementation.apply(this, args);
    };
  }

  const mock = vi.fn(wrapImplementation(implementation));
  const originalMockImplementation = mock.mockImplementation.bind(mock);
  const originalMockImplementationOnce = mock.mockImplementationOnce.bind(mock);

  mock.mockImplementation = (nextImplementation) => originalMockImplementation(wrapImplementation(nextImplementation));
  mock.mockImplementationOnce = (nextImplementation) => originalMockImplementationOnce(wrapImplementation(nextImplementation));

  return mock;
}

if (moduleInternals._load !== state.patchedLoad) {
  state.patchedLoad = function patchedLoad(
    this: ModuleInternals,
    request: string,
    parent: ModuleParent,
    isMain: boolean
  ): unknown {
    const resolvedRequest = resolveRequest(request, parent);

    if (state.mockFactories.has(resolvedRequest)) {
      if (!state.mockInstances.has(resolvedRequest)) {
        const factory = state.mockFactories.get(resolvedRequest);
        state.mockInstances.set(resolvedRequest, typeof factory === 'function' ? factory() : factory);
      }

      return state.mockInstances.get(resolvedRequest);
    }

    return state.originalLoad.call(this, request, parent, isMain);
  };

  moduleInternals._load = state.patchedLoad;
}

globalThis.jest = {
  fn: createMockFunction as typeof vi.fn,
  spyOn: vi.spyOn,
  clearAllMocks: () => vi.clearAllMocks(),
  useFakeTimers: (...args: Parameters<typeof vi.useFakeTimers>) => vi.useFakeTimers(...args),
  useRealTimers: () => vi.useRealTimers(),
  advanceTimersByTime: (...args: Parameters<typeof vi.advanceTimersByTime>) => vi.advanceTimersByTime(...args),
  mock: registerMock,
  doMock: registerMock,
  resetModules() {
    state.mockFactories.clear();
    clearProjectRequireCache();
  },
  isolateModules(callback: () => void) {
    clearProjectRequireCache();
    callback();
  }
};
