const { MAX_NEWS_PAGE, MAX_RECENT_HOURS, parseNewsQuery } = require('./newsQuery');

describe('newsQuery', () => {
  test('bounds page and recent-hours query parameters', () => {
    expect(parseNewsQuery({ page: '1000', pageSize: '999', recentHours: '999' })).toEqual(expect.objectContaining({
      page: MAX_NEWS_PAGE,
      pageSize: 30,
      recentHours: MAX_RECENT_HOURS
    }));
  });

  test('ignores invalid recent-hours query parameters', () => {
    expect(parseNewsQuery({ recentHours: '-1' }).recentHours).toBeNull();
    expect(parseNewsQuery({ recentHours: '0' }).recentHours).toBeNull();
    expect(parseNewsQuery({ recentHours: 'not-a-number' }).recentHours).toBeNull();
  });
});
