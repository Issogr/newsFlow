import React from 'react';
import { render, screen } from '@testing-library/react';
import NewsCard from './NewsCard';

const t = (key) => key;

const group = {
  id: 'group-1',
  title: 'Headline',
  pubDate: '2026-03-07T10:00:00.000Z',
  topics: [],
  items: [
    {
      id: 'article-1',
      sourceId: 'source-a',
      source: 'Source A'
    }
  ]
};

describe('NewsCard', () => {
  test('renders a safe external link for http urls', () => {
    render(
      <NewsCard
        group={{ ...group, url: 'https://example.com/story' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.getByRole('link', { name: 'openOriginalSource' })).toHaveAttribute('href', 'https://example.com/story');
  });

  test('disables unsafe external links', () => {
    render(
      <NewsCard
        group={{ ...group, url: 'javascript:alert(1)' }}
        locale="en"
        t={t}
        onOpenReader={jest.fn()}
      />
    );

    expect(screen.queryByRole('link', { name: 'openOriginalSource' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'openOriginalSource' })).toBeDisabled();
  });
});
