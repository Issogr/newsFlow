const { createConcurrencyLimiter } = require('./concurrency');

describe('createConcurrencyLimiter', () => {
  test('shares one concurrency cap across independent callers', async () => {
    const limit = createConcurrencyLimiter(2);
    let activeCount = 0;
    let maxActiveCount = 0;
    const run = () => limit(async () => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeCount -= 1;
    });

    await Promise.all([run(), run(), run(), run()]);

    expect(maxActiveCount).toBe(2);
  });

  test('removes aborted work while it is queued', async () => {
    const limit = createConcurrencyLimiter(1);
    let releaseFirst!: () => void;
    const first = limit(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const controller = new globalThis.AbortController();
    const second = limit(() => Promise.resolve(), { signal: controller.signal });

    controller.abort();

    await expect(second).rejects.toMatchObject({ name: 'AbortError' });
    releaseFirst();
    await first;
  });
});
