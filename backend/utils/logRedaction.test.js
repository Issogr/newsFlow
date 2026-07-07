const { redactUrlForLog } = require('./logRedaction');

describe('logRedaction', () => {
  test('redacts sensitive query values and URL credentials', () => {
    expect(redactUrlForLog('GET /admin/setup?token=secret&view=1 HTTP/1.1')).toBe('GET /admin/setup?token=[REDACTED]&view=1 HTTP/1.1');
    expect(redactUrlForLog('https://user:pass@example.com/feed.xml?api_key=secret&lang=en')).toBe('https://[REDACTED]@example.com/feed.xml?api_key=[REDACTED]&lang=en');
  });

  test('can redact all query values for user-provided outbound URLs', () => {
    expect(redactUrlForLog('https://feeds.example.com/rss?customer=alice&signature=secret', { redactAllQuery: true }))
      .toBe('https://feeds.example.com/rss?customer=[REDACTED]&signature=[REDACTED]');
  });
});
