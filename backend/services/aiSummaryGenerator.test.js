const aiSummaryGenerator = require('./aiSummaryGenerator');

describe('aiSummaryGenerator', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  test('uses cached reader text in the summary prompt when available', () => {
    const prompt = aiSummaryGenerator._buildPrompt({
      key: 'science',
      label: 'Science',
      topics: ['Scienza'],
      periodStart: '2026-05-21T07:00:00.000Z',
      periodEnd: '2026-05-21T13:00:00.000Z'
    }, [
      {
        id: 'article-1',
        title: 'Short RSS title',
        description: 'Short RSS description',
        readerText: 'Full cached reader text with significantly more useful article context.',
        source: 'BBC',
        pubDate: '2026-05-21T08:00:00.000Z',
        url: 'https://example.com/article'
      }
    ]);

    const payload = JSON.parse(prompt.split('\n').at(-1));

    expect(prompt).toContain('Exclude promotional shopping deals');
    expect(prompt).toContain('Do not name the title or opening after a time of day');
    expect(payload.articles[0]).toEqual(expect.objectContaining({
      ref: 1,
      description: 'Full cached reader text with significantly more useful article context.',
      contentType: 'cached_reader_text'
    }));
    expect(payload.articles[0]).not.toHaveProperty('id');
  });

  test('keeps prompt article text within an adaptive budget', () => {
    process.env = {
      ...originalEnv,
      AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS: '10000'
    };
    const articles = Array.from({ length: 40 }, (_, index) => ({
      id: `article-${index}`,
      title: `Article ${index}`,
      description: 'RSS description',
      readerText: 'Reader text with useful context. '.repeat(200),
      source: 'BBC',
      pubDate: '2026-05-21T08:00:00.000Z',
      url: `https://example.com/article-${index}`
    }));

    const prompt = aiSummaryGenerator._buildPrompt({ key: 'science', label: 'Science' }, articles);
    const payload = JSON.parse(prompt.split('\n').at(-1));

    expect(aiSummaryGenerator._getArticleTextLimit(articles.length)).toBe(250);
    expect(payload.articles).toHaveLength(40);
    expect(payload.articles[0].description.length).toBeLessThanOrEqual(250);
    expect(payload.articles[0]).not.toHaveProperty('url');
  });

  test('uses a conservative default text budget for large prompts', () => {
    expect(aiSummaryGenerator._getArticleTextLimit(120)).toBe(250);
  });
});
