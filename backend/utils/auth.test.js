const { extractBearerToken, safeTokenCompare } = require('./auth');

describe('auth utils', () => {
  test('extractBearerToken returns empty string for invalid values', () => {
    expect(extractBearerToken()).toBe('');
    expect(extractBearerToken('Token abc')).toBe('');
    expect(extractBearerToken('Bearer')).toBe('');
  });

  test('extractBearerToken returns token for valid bearer header', () => {
    expect(extractBearerToken('Bearer my-token')).toBe('my-token');
  });

  test('safeTokenCompare validates equal token only', () => {
    expect(safeTokenCompare('abc', 'abc')).toBe(true);
    expect(safeTokenCompare('abc', 'abcd')).toBe(false);
    expect(safeTokenCompare('abc', 'def')).toBe(false);
  });
});
