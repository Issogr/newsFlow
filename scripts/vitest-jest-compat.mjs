import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vi } from 'vitest';

const require = Module.createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

const state = globalThis.__NEWSFLOW_VITEST_JEST_COMPAT__ || {
  mockFactories: new Map(),
  mockInstances: new Map(),
  originalLoad: Module._load,
  originalResolveFilename: Module._resolveFilename
};

globalThis.__NEWSFLOW_VITEST_JEST_COMPAT__ = state;

function createParentModule(filename) {
  return {
    id: filename,
    filename,
    paths: Module._nodeModulePaths(path.dirname(filename))
  };
}

function parseStackFilename(line) {
  const match = line.match(/\((.*):(\d+):(\d+)\)$/) || line.match(/at (.*):(\d+):(\d+)$/);
  return match?.[1];
}

function getCallerFilename() {
  const stack = new Error().stack || '';
  const stackLines = stack.split('\n').slice(2);

  for (const line of stackLines) {
    const filename = parseStackFilename(line);
    if (!filename || filename === __filename || filename.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }

    return filename;
  }

  return path.join(process.cwd(), '__vitest_test__.js');
}

function resolveRequest(request, parent) {
  try {
    return state.originalResolveFilename.call(Module, request, parent);
  } catch (_error) {
    return request;
  }
}

function resolveRequestFromCaller(request) {
  return resolveRequest(request, createParentModule(getCallerFilename()));
}

function registerMock(request, factory) {
  const resolvedRequest = resolveRequestFromCaller(request);
  state.mockFactories.set(resolvedRequest, factory);
  state.mockInstances.delete(resolvedRequest);
}

function clearProjectRequireCache() {
  const projectRoot = path.resolve(process.cwd());
  const projectRootPrefix = `${projectRoot}${path.sep}`;

  for (const filename of Object.keys(require.cache)) {
    if ((filename === projectRoot || filename.startsWith(projectRootPrefix)) && !filename.includes(`${path.sep}node_modules${path.sep}`)) {
      delete require.cache[filename];
    }
  }

  state.mockInstances.clear();
}

function createMockFunction(implementation) {
  function wrapImplementation(nextImplementation) {
    if (nextImplementation === undefined) {
      return undefined;
    }

    return function mockImplementation(...args) {
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

if (Module._load !== state.patchedLoad) {
  state.patchedLoad = function patchedLoad(request, parent, isMain) {
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

  Module._load = state.patchedLoad;
}

globalThis.jest = {
  fn: createMockFunction,
  spyOn: (...args) => vi.spyOn(...args),
  clearAllMocks: () => vi.clearAllMocks(),
  useFakeTimers: (...args) => vi.useFakeTimers(...args),
  useRealTimers: () => vi.useRealTimers(),
  advanceTimersByTime: (...args) => vi.advanceTimersByTime(...args),
  mock: registerMock,
  doMock: registerMock,
  resetModules() {
    state.mockFactories.clear();
    clearProjectRequireCache();
  },
  isolateModules(callback) {
    clearProjectRequireCache();
    callback();
  }
};
