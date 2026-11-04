import { expect, test } from 'vitest';
import { getLoadedNewsGroups } from './newsFeedGroups';
import type { NewsGroup } from '../types';

test('silent story merges keep corrected articles and the unrefreshed tail', () => {
  const current: NewsGroup[] = ['first', 'second', 'tail'].map((id) => ({
    id, items: [{ id, title: `Old ${id}`, pubDate: '2026-11-04T10:00:00.000Z' }]
  }));
  const incoming: NewsGroup[] = [{
    id: 'joined', items: current.slice(0, 2).flatMap((group) => group.items || []).map((item) => ({
      ...item, title: `Corrected ${item.id}`, topics: ['Science'], storyGroupId: 'joined-story'
    }))
  }];

  const result = getLoadedNewsGroups(current, {
    append: false, silent: true, isReadLaterView: false, maxRetainedGroups: 72,
    mergedItems: incoming, responseItems: incoming
  });

  expect(result).toHaveLength(2);
  expect(result.flatMap((group) => group.items || []).map((item) => item.title).sort())
    .toEqual(['Corrected first', 'Corrected second', 'Old tail']);
});

test('silent refresh splits corrected stories, clears saved state, and preserves untouched cards', () => {
  const current: NewsGroup[] = [{
    id: 'joined', title: 'Old story', readLater: true, readLaterArticleIds: ['a'],
    items: ['a', 'b'].map((id) => ({ id, title: id, storyGroupId: 'joined' }))
  }, { id: 'tail', items: [{ id: 'tail' }] }];
  const incoming: NewsGroup[] = ['a', 'b', 'brand-new'].map((id) => ({
    id, title: `Corrected ${id}`, items: [{ id, title: `Corrected ${id}` }],
    readLater: false, readLaterArticleIds: []
  }));

  const result = getLoadedNewsGroups(current, {
    append: false, silent: true, isReadLaterView: false, maxRetainedGroups: 72,
    mergedItems: incoming, responseItems: incoming
  });

  expect(result.map((group) => group.id)).toEqual(['a', 'b', 'tail']);
  expect(result[0]).toMatchObject({ readLater: false, readLaterArticleIds: [] });
  expect(result.flatMap((group) => group.items).map((item) => item.id)).toEqual(['a', 'b', 'tail']);
  expect(current[0].items).toHaveLength(2);
  expect(current[0].readLater).toBe(true);
});
