const { groupSimilarNews } = require('./newsAggregatorGrouping');

describe('newsAggregatorGrouping', () => {
  test('groups reworded articles when AI story group id matches', () => {
    const groups = groupSimilarNews([
      {
        id: 'article-1',
        sourceId: 'source-a',
        source: 'Source A',
        title: 'Meloni meets Trump in Rome',
        description: 'Talks focused on tariffs and Ukraine.',
        url: 'https://example.com/a',
        pubDate: '2026-03-15T14:30:00.000Z',
        storyGroupId: 'ai-story-1'
      },
      {
        id: 'article-2',
        sourceId: 'source-b',
        source: 'Source B',
        title: 'Tariffs and Ukraine at Trump Meloni summit',
        description: 'The two leaders met in the Italian capital.',
        url: 'https://example.com/b',
        pubDate: '2026-03-15T14:10:00.000Z',
        storyGroupId: 'ai-story-1'
      }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(expect.objectContaining({
      sources: ['Source A', 'Source B']
    }));
    expect(groups[0].items.map((item: { id: string }) => item.id)).toEqual(['article-1', 'article-2']);
  });

  test('groups same-source article versions when AI story group id matches', () => {
    const groups = groupSimilarNews([
      {
        id: 'article-1',
        sourceId: 'source-a',
        source: 'Source A',
        title: 'Meloni meets Trump in Rome',
        description: 'Talks focused on tariffs and Ukraine.',
        url: 'https://example.com/a',
        pubDate: '2026-03-15T14:30:00.000Z',
        storyGroupId: 'ai-story-1'
      },
      {
        id: 'article-2',
        sourceId: 'source-a',
        source: 'Source A',
        title: 'Tariffs and Ukraine at Trump Meloni summit',
        description: 'The same outlet published a second version of the story.',
        url: 'https://example.com/b',
        pubDate: '2026-03-15T14:10:00.000Z',
        storyGroupId: 'ai-story-1'
      }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual(expect.objectContaining({
      sources: ['Source A']
    }));
    expect(groups[0].items.map((item: { id: string }) => item.id)).toEqual(['article-1', 'article-2']);
  });

  test('merges existing groups when a later article bridges story and canonical keys', () => {
    const groups = groupSimilarNews([
      {
        id: 'article-1',
        sourceId: 'source-a',
        source: 'Source A',
        title: 'Initial report on Rome summit',
        description: 'First report about the summit.',
        url: 'https://example.com/shared-story?utm_source=home',
        canonicalUrl: 'https://example.com/shared-story',
        pubDate: '2026-03-15T14:30:00.000Z'
      },
      {
        id: 'article-2',
        sourceId: 'source-b',
        source: 'Source B',
        title: 'Tariffs and Ukraine at Trump Meloni summit',
        description: 'The two leaders met in the Italian capital.',
        url: 'https://example.com/b',
        pubDate: '2026-03-15T14:20:00.000Z',
        storyGroupId: 'ai-story-1'
      },
      {
        id: 'article-3',
        sourceId: 'source-c',
        source: 'Source C',
        title: 'Summit talks in Rome cover tariffs and Ukraine',
        description: 'A follow-up links the canonical report to the AI story group.',
        url: 'https://example.com/shared-story?utm_source=followup',
        canonicalUrl: 'https://example.com/shared-story',
        pubDate: '2026-03-15T14:10:00.000Z',
        storyGroupId: 'ai-story-1'
      }
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item: { id: string }) => item.id)).toEqual(['article-1', 'article-2', 'article-3']);
  });
});
