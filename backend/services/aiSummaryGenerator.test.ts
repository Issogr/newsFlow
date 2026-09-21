const aiSummaryGenerator = require('./aiSummaryGenerator');
import type { Mock } from 'vitest';

describe('aiSummaryGenerator', () => {
  const originalEnv = process.env;
  let fetchMock: Mock | undefined;

  afterEach(() => {
    fetchMock?.mockRestore();
    process.env = originalEnv;
  });

  test('requires both locales through structured output', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_SUMMARY_MODEL: 'test-summary-model'
    };
    const generatedResponse = {
      choices: [{
        message: {
          content: JSON.stringify({
            en: { paragraphs: ['English summary text with enough detail and a valid source citation for this test [1].'] },
            it: { paragraphs: ['Testo italiano del riepilogo con dettagli sufficienti e una citazione valida per questo test [1].'] }
          })
        }
      }]
    };
    const sendMock = jest.fn()
      .mockResolvedValueOnce(generatedResponse)
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ supported: true, issues: [] }) } }] });
    fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => (
      Response.json(await sendMock(JSON.parse(String(options?.body))))
    ));

    const summary = await aiSummaryGenerator.generateSummaryForArticles({ key: 'science', label: 'Science' }, [{
      id: 'article-1',
      title: 'Science update',
      description: 'A useful science article.',
      source: 'BBC'
    }]);

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      response_format: expect.objectContaining({
        type: 'json_schema',
        json_schema: expect.objectContaining({
          strict: true,
          schema: expect.objectContaining({ required: ['en', 'it'] })
        })
      })
    }));
    const generationInput = JSON.parse(sendMock.mock.calls[0][0].messages[1].content.split('\n').at(-1));
    const verificationInput = JSON.parse(sendMock.mock.calls[1][0].messages[1].content.split('\n').at(-1));
    expect(verificationInput.articles).toEqual(generationInput.articles);
    expect(summary.inputArticles).toEqual(generationInput.articles);
    expect(verificationInput.briefings).toEqual(summary.summaryTextByLocale);
  });

  test.each([
    ['contradictory claims', { supported: false, issues: ['en/it: first-ever conflicts with previous occurrences [1]'] }],
    ['unsupported funding', { supported: false, issues: ['en/it: the cited vote was postponed, not approved [1]'] }],
    ['translation drift', { supported: false, issues: ['it: a statewide measure became a national measure [1]'] }],
    ['wrong language', { supported: false, issues: ['it: briefing is written in English'] }],
    ['ambiguous verdict', { supported: true, issues: ['A claim is unsupported [1]'] }],
    ['missing verdict', {}],
    ['invalid verdict types', { supported: 'true', issues: [] }]
  ])('rejects %s before publishing', async (_label, verdict) => {
    process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
    const draft = {
      en: { paragraphs: ['The council approved ten billion euros in funding and passed the new law unanimously [1].'] },
      it: { paragraphs: ['Il consiglio ha approvato dieci miliardi di euro di finanziamenti e la nuova legge all’unanimita [1].'] }
    };
    fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(draft) } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(verdict) } }] }));

    await expect(aiSummaryGenerator.generateSummaryForArticles({ key: 'politics' }, [{
      id: 'council', title: 'Council delays vote',
      description: 'The council postponed its vote. No funding was approved.', source: 'Example News'
    }])).rejects.toMatchObject({ code: 'SUMMARY_VALIDATION_FAILED' });
  });

  test('fails closed when the grounding request fails', async () => {
    process.env = { ...originalEnv, OPENROUTER_API_KEY: 'test-key' };
    fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify({
        en: { paragraphs: ['Officials postponed a council vote and did not approve any funding during the session [1].'] },
        it: { paragraphs: ['I funzionari hanno rinviato il voto del consiglio senza approvare finanziamenti durante la seduta [1].'] }
      }) } }] }))
      .mockResolvedValueOnce(Response.json({ error: { message: 'Verification unavailable' } }, { status: 400 }));
    await expect(aiSummaryGenerator.generateSummaryForArticles({ key: 'politics' }, [{
      id: 'council', title: 'Council delays vote', description: 'No funding was approved.'
    }])).rejects.toThrow('Verification unavailable');
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
    expect(prompt).toContain('Preserve names, numbers, units, dates, negations, attribution, and uncertainty');
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
    expect(payload.articles.reduce((total: number, article: { description: string }) => total + article.description.length, 0)).toBeLessThanOrEqual(10000);
    expect(payload.articles[0]).not.toHaveProperty('url');

    delete process.env.AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS;
    expect(aiSummaryGenerator._getArticleTextLimit(120)).toBe(250);
  });

  test('keeps the completion token budget above observed bilingual output sizes', () => {
    // Regression: 7 articles produced ~1500 output tokens and were truncated
    // mid-JSON by the old 900 + 55/article budget.
    expect(aiSummaryGenerator._getCompletionTokenBudget(1)).toBe(1565);
    expect(aiSummaryGenerator._getCompletionTokenBudget(7)).toBe(1955);
    expect(aiSummaryGenerator._getCompletionTokenBudget(120)).toBe(4000);
  });

  test('preserves more evidence per story at the default 24-article selection', () => {
    process.env = { ...originalEnv };
    delete process.env.AI_SUMMARY_PROMPT_TEXT_BUDGET_CHARS;
    const articles = Array.from({ length: 24 }, (_, index) => ({
      id: String(index), title: 'Council report',
      description: `${'Background information. '.repeat(30)}No funding was approved. ${'Further details. '.repeat(50)}`
    }));
    const input = JSON.parse(aiSummaryGenerator._buildPrompt({ key: 'politics' }, articles).split('\n').at(-1));
    expect(input.articles[0].description).toContain('No funding was approved.');
    expect(input.articles[0].description.length).toBe(1250);
    expect(input.articles.reduce((sum: number, article: { description: string }) => sum + article.description.length, 0)).toBeLessThanOrEqual(30000);
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

  test.each(['[0]', '[0] [999]', '[999]', '[1] [1, 2]', '[1] [-1]'])('rejects invalid citation sequence %s', (citations) => {
    expect(() => aiSummaryGenerator._validateGeneratedSummary({ summaryTextByLocale: {
      en: `Officials discussed a proposed policy in detail during the public session ${citations}.`,
      it: `I funzionari hanno discusso in dettaglio una proposta durante la seduta pubblica ${citations}.`
    } }, 1)).toThrow(/citation/u);
  });

  test.each(['en', 'it'])('rejects uncited paragraphs in %s', (locale) => {
    const texts = {
      en: 'Officials discussed a proposed policy in detail during the public session [1].',
      it: 'I funzionari hanno discusso in dettaglio una proposta durante la seduta pubblica [1].'
    };
    expect(() => aiSummaryGenerator._validateGeneratedSummary({ summaryTextByLocale: {
      ...texts, [locale]: `${texts[locale as keyof typeof texts]}\n\nAn additional claim has no supporting reference.`
    } }, 1)).toThrow('uncited paragraph');
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
