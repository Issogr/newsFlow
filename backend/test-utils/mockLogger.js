function createMockLogger() {
  return {
    debug: globalThis.jest.fn(),
    info: globalThis.jest.fn(),
    warn: globalThis.jest.fn(),
    error: globalThis.jest.fn()
  };
}

module.exports = createMockLogger;
