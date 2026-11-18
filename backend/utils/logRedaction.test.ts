import logRedaction from './logRedaction';
const { redactUrlForLog } = logRedaction;

describe('logRedaction', () => {
  test('removes signed paths and tokens from error messages and stacks', () => {
    const error = new Error('Cannot fetch https://feeds.example/private-key?sig=signed-value with Bearer private-key');
    for (const text of [error.message, error.stack]) {
      expect(logRedaction.redactErrorForLog(text)).not.toMatch(/private-key|signed-value/);
    }
  });
  test('redacts sensitive query values and URL credentials', () => {
    expect(redactUrlForLog('GET /admin/setup?token=secret&view=1 HTTP/1.1')).toBe('GET /admin/setup?token=[REDACTED]&view=1 HTTP/1.1');
    expect(redactUrlForLog('https://user:pass@example.com/feed.xml?api_key=secret&lang=en')).toBe('https://[REDACTED]@example.com/feed.xml?api_key=[REDACTED]&lang=en');
  });

  test('can redact all query values for user-provided outbound URLs', () => {
    expect(redactUrlForLog('https://feeds.example.com/rss?customer=alice&signature=secret', { redactAllQuery: true }))
      .toBe('https://feeds.example.com/rss?customer=[REDACTED]&signature=[REDACTED]');
  });
});
