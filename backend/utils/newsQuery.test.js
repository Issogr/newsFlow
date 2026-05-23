const { MAX_NEWS_PAGE, MAX_RECENT_HOURS, parseNewsQuery } = require('./newsQuery');

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
});
