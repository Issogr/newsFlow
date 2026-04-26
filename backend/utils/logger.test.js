const logger = require('./logger');

describe('logger', () => {
  test('recognizes expected AbortSignal timeout rejections', () => {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';

    expect(logger._isExpectedTimeoutRejection(error)).toBe(true);
  });

  test('does not treat unrelated errors as expected timeout rejections', () => {
    expect(logger._isExpectedTimeoutRejection(new Error('Network failed'))).toBe(false);
  });

  test('formats unhandled rejection metadata without replacing the log message', () => {
    const error = new Error('Unexpected failure');

    expect(logger._formatUnhandledRejection(error)).toEqual({
      errorMessage: 'Unexpected failure',
      stack: expect.any(String),
    });
  });
});
