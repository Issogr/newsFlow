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
    expect(prompt).toContain('Ignore crossover articles where another category is the main story');
    expect(prompt).toContain('Do not generate or include a title');
    expect(prompt).toContain('{"en":{"paragraphs"');
    expect(prompt).not.toContain('Brief title');
    expect(prompt).not.toContain('Titolo breve');
    expect(prompt).toContain('Start a new paragraph whenever the subject, argument, or subtopic changes');
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
    const articles = Array.from({ length: 60 }, (_, index) => ({
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

    expect(aiSummaryGenerator._getArticleTextLimit(articles.length)).toBe(166);
    expect(payload.articles).toHaveLength(60);
    expect(payload.articles.reduce((total, article) => total + article.description.length, 0)).toBeLessThanOrEqual(10000);
    expect(payload.articles[0]).not.toHaveProperty('url');

    delete process.env.AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS;
    expect(aiSummaryGenerator._getArticleTextLimit(120)).toBe(250);
  });

  test('removes promotional price-drop sentences from generated summaries', () => {
    const normalized = aiSummaryGenerator._normalizeGeneratedSummary({
      en: {
        title: 'Technology briefing',
        paragraphs: [
          'Policy makers discussed chip rules [1]. The Twelve South AirFly Pro 2 Bluetooth adapter reached one of its best prices before summer travel.'
        ]
      },
      it: {
        title: 'Sintesi tecnologia',
        paragraphs: [
          'I regolatori hanno discusso nuove regole sui chip [1]. L\'adattatore Bluetooth AirFly Pro 2 ha raggiunto uno dei suoi prezzi migliori in vista dei viaggi estivi.'
        ]
      }
    });

    expect(normalized).not.toHaveProperty('title');
    expect(normalized).not.toHaveProperty('titleByLocale');
    expect(normalized.summaryTextByLocale.en).toBe('Policy makers discussed chip rules [1].');
    expect(normalized.summaryTextByLocale.it).toBe('I regolatori hanno discusso nuove regole sui chip [1].');
  });

  test('validates generated summary citations and language quality', () => {
    expect(() => aiSummaryGenerator._validateGeneratedSummary({
      summaryTextByLocale: {
        en: 'Policy makers discussed a new chip rule with industry leaders and regulators during the window [2].',
        it: 'I regolatori hanno discusso una nuova regola sui chip con aziende e istituzioni nella finestra [2].'
      }
    }, 1)).toThrow('invalid citation [2]');

    expect(() => aiSummaryGenerator._validateGeneratedSummary({
      summaryTextByLocale: {
        en: 'Policy makers discussed a new chip rule with industry leaders and regulators during the window.',
        it: 'I regolatori hanno discusso una nuova regola sui chip con aziende e istituzioni nella finestra [1].'
      }
    }, 1)).toThrow('English text has no citations');

    expect(() => aiSummaryGenerator._validateGeneratedSummary({
      summaryTextByLocale: {
        en: 'Policy makers discussed a new chip rule with industry leaders and regulators during the window [1].',
        it: 'Policy makers discussed a new chip rule with industry leaders and regulators during the window [1].'
      }
    }, 1)).toThrow('identical');
  });

  test.each([
    ['configured thematic summary model', 'summary-model', 'summary-model'],
    ['default thematic summary model', undefined, 'qwen/qwen3.7-flash']
  ])('uses the %s', (label, configuredModel, expectedModel) => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_SUMMARY_MODEL: configuredModel
    };

    expect(aiSummaryGenerator._getConfig()).toEqual(expect.objectContaining({
      enabled: true,
      model: expectedModel
    }));
  });
});
