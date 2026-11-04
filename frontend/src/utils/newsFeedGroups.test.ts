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
