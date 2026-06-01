const { MAX_NEWS_PAGE, MAX_RECENT_HOURS, MAX_SOURCE_FILTERS, MAX_TOPIC_FILTERS, parseNewsQuery } = require('./newsQuery');

describe('newsQuery', () => {
  test('parses feed query parameters while bounding pagination and optional recency', () => {
    expect(parseNewsQuery({
      page: '1000',
      pageSize: '999',
      recentHours: '999',
      sources: 'ansa, bbc, ',
      topics: 'Economia',
      refresh: 'true',
      includeFilters: 'true'
    })).toEqual(expect.objectContaining({
      page: MAX_NEWS_PAGE,
      pageSize: 30,
      recentHours: MAX_RECENT_HOURS,
      sourceIds: ['ansa', 'bbc'],
      topics: ['Economia'],
      refresh: true,
      includeFilters: true
    }));

    ['-1', '0', 'not-a-number'].forEach((recentHours) => {
      expect(parseNewsQuery({ recentHours }).recentHours).toBeNull();
    });
  });

  test('rejects abusive source and topic filter lists before SQL construction', () => {
    const tooManySources = Array.from({ length: MAX_SOURCE_FILTERS + 1 }, (_, index) => `source-${index}`).join(',');
    const tooManyTopics = Array.from({ length: MAX_TOPIC_FILTERS + 1 }, (_, index) => `topic-${index}`).join(',');

    expect(() => parseNewsQuery({ sources: tooManySources })).toThrow('sources can include at most');
    expect(() => parseNewsQuery({ topics: tooManyTopics })).toThrow('topics can include at most');
    expect(() => parseNewsQuery({ topics: 'x'.repeat(121) })).toThrow('topics values must be');
  });
});
