const { parseIntegerEnv } = require('./env');

describe('env utilities', () => {
  afterEach(() => {
    delete process.env.TEST_INTEGER_ENV;
  });

  test('falls back when an integer env value is malformed', () => {
    process.env.TEST_INTEGER_ENV = 'not-a-number';

    expect(parseIntegerEnv('TEST_INTEGER_ENV', 24)).toBe(24);
  });

  test('falls back when an integer env value is outside configured bounds', () => {
    process.env.TEST_INTEGER_ENV = '-1';

    expect(parseIntegerEnv('TEST_INTEGER_ENV', 24, { min: 0 })).toBe(24);
  });
});
