import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MobileBottomNav from './MobileBottomNav';

const t = (key, params = {}) => {
  const map = {
    sources: 'Sources',
    topics: 'Topics',
    latestHours: ({ hours }) => `Last ${hours} hours`,
    searchPlaceholder: 'Search...',
    searchLabel: 'Search',
    cancel: 'Cancel',
    noNewsText: 'No news found.',
  };
  const value = map[key];
  return typeof value === 'function' ? value(params) : value;
};

function renderNav(overrides = {}) {
  const defaults = {
    visibleSources: [
      { id: 's1', name: 'BBC', count: 5 },
      { id: 's2', name: 'CNN', count: 3 },
    ],
    availableTopics: [
      { topic: 'tech', count: 4 },
      { topic: 'sport', count: 2 },
    ],
    activeFilters: { sourceIds: [], topics: [] },
    showRecentOnly: false,
    search: '',
    recentHours: 3,
    t,
    locale: 'en',
    onToggleFilter: vi.fn(),
    onToggleRecent: vi.fn(),
    onSearchChange: vi.fn(),
    onSearchClear: vi.fn(),
    activeFiltersCount: 0,
    visible: true,
  };
  return render(<MobileBottomNav {...defaults} {...overrides} />);
}

function getNavButton(name) {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}

describe('MobileBottomNav', () => {
  it('renders four nav buttons', () => {
    renderNav();
    expect(getNavButton('Sources')).toBeInTheDocument();
    expect(getNavButton('Topics')).toBeInTheDocument();
    expect(getNavButton('Last 3 hours')).toBeInTheDocument();
    expect(getNavButton('Search')).toBeInTheDocument();
  });

  it('opens the sources bubble when Sources is pressed', () => {
    renderNav();
    fireEvent.click(getNavButton('Sources'));
    expect(screen.getByText('BBC')).toBeInTheDocument();
    expect(screen.getByText('CNN')).toBeInTheDocument();
  });

  it('closes an open sources bubble when Sources is pressed again', () => {
    renderNav();
    const sourcesButton = getNavButton('Sources');

    fireEvent.click(sourcesButton);
    expect(sourcesButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(sourcesButton);
    fireEvent.click(sourcesButton);
    expect(sourcesButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the topics bubble when Topics is pressed', () => {
    renderNav();
    fireEvent.click(getNavButton('Topics'));
    expect(screen.getByText('Technology')).toBeInTheDocument();
    expect(screen.getByText('Sport')).toBeInTheDocument();
  });

  it('closes an open topics bubble when Topics is pressed again', () => {
    renderNav();
    const topicsButton = getNavButton('Topics');

    fireEvent.click(topicsButton);
    expect(topicsButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.mouseDown(topicsButton);
    fireEvent.click(topicsButton);
    expect(topicsButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles time filter when Time button is pressed', () => {
    const onToggleRecent = vi.fn();
    renderNav({ onToggleRecent });
    fireEvent.click(getNavButton('Last 3 hours'));
    expect(onToggleRecent).toHaveBeenCalled();
  });

  it('enters search mode when Search is pressed', () => {
    renderNav();
    fireEvent.click(getNavButton('Search'));
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('exits search mode and clears search on Cancel', () => {
    const onSearchClear = vi.fn();
    renderNav({ onSearchClear, search: 'query' });
    fireEvent.click(getNavButton('Search'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSearchClear).toHaveBeenCalled();
    expect(getNavButton('Sources')).toBeInTheDocument();
  });

  it('calls onToggleFilter when a source pill is clicked', () => {
    const onToggleFilter = vi.fn();
    renderNav({ onToggleFilter });
    fireEvent.click(getNavButton('Sources'));
    fireEvent.click(screen.getByText('BBC'));
    expect(onToggleFilter).toHaveBeenCalledWith('sourceIds', 's1');
  });

  it('calls onSearchChange when typing in search input', () => {
    const onSearchChange = vi.fn();
    renderNav({ onSearchChange });
    fireEvent.click(getNavButton('Search'));
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'news' } });
    expect(onSearchChange).toHaveBeenCalledWith('news');
  });

  it('shows active badge counts on buttons', () => {
    renderNav({
      activeFilters: { sourceIds: ['s1'], topics: ['tech'] },
      showRecentOnly: true,
      search: 'query',
    });
    const badges = screen.getAllByText('1');
    expect(badges.length).toBe(2);
  });
});
