const originalArticleRetentionHours = process.env.ARTICLE_RETENTION_HOURS;
const { getArticleRetentionHours } = require('./articleRetention');

describe('articleRetention config', () => {
  afterEach(() => {
    if (originalArticleRetentionHours === undefined) {
      delete process.env.ARTICLE_RETENTION_HOURS;
    } else {
      process.env.ARTICLE_RETENTION_HOURS = originalArticleRetentionHours;
    }
  });

  test.each([
    { value: undefined, expected: 24, expectedNonNegative: 24 },
    { value: '', expected: 24, expectedNonNegative: 24 },
    { value: 'invalid', expected: 24, expectedNonNegative: 24 },
    { value: '-5', expected: -5, expectedNonNegative: 24 },
    { value: '0', expected: 0, expectedNonNegative: 0 },
    { value: '12.9', expected: 12, expectedNonNegative: 12 },
    { value: '12hours', expected: 12, expectedNonNegative: 12 }
  ])('parses $value without changing retention edge cases', ({ value, expected, expectedNonNegative }) => {
    if (value === undefined) {
      delete process.env.ARTICLE_RETENTION_HOURS;
    } else {
      process.env.ARTICLE_RETENTION_HOURS = value;
    }

    expect(getArticleRetentionHours({ allowNegative: true })).toBe(expected);
    expect(getArticleRetentionHours()).toBe(expectedNonNegative);
  });
});
