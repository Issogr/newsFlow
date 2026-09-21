import { vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('filters console levels, preserves metadata and error stacks, and stays silent in tests', async () => {
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('LOG_LEVEL', 'warn');
  const logger = (await import('./logger')).default;
  logger.info('hidden');
  logger.debug('hidden');
  expect(output).not.toHaveBeenCalled();
  logger.warn('AI request metric', { articleCount: 3 });
  logger.error(new Error('extraction failed'));
  expect(output).toHaveBeenNthCalledWith(1, expect.stringMatching(/\[WARN\].*AI request metric.*articleCount.*3/));
  expect(output).toHaveBeenNthCalledWith(2, expect.stringContaining('extraction failed'));
  expect(output.mock.calls[1][0]).toContain('logger.test.ts');

  vi.stubEnv('NODE_ENV', 'test');
  vi.resetModules();
  (await import('./logger')).default.error('silent');
  expect(output).toHaveBeenCalledTimes(2);
});
