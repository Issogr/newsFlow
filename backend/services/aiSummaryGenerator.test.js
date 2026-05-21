const aiSummaryGenerator = require('./aiSummaryGenerator');

describe('aiSummaryGenerator', () => {
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

    expect(payload.articles[0]).toEqual(expect.objectContaining({
      ref: 1,
      description: 'Full cached reader text with significantly more useful article context.',
      contentType: 'cached_reader_text'
    }));
    expect(payload.articles[0]).not.toHaveProperty('id');
  });
});
