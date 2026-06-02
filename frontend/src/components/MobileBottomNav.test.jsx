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
    visible: true,
  };
  return render(<MobileBottomNav {...defaults} {...overrides} />);
}

function getNavButton(name) {
  return screen.getByRole('button', { name: new RegExp(name, 'i') });
}

describe('MobileBottomNav', () => {
  it.each([
    ['Sources', ['BBC', 'CNN']],
    ['Topics', ['Technology', 'Sport']]
  ])('opens and closes the %s bubble', (buttonName, optionLabels) => {
    renderNav();
    const button = getNavButton(buttonName);

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    optionLabels.forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });

    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps sources open when a mobile tap emits follow-up mouse events', () => {
    renderNav();
    const sourcesButton = getNavButton('Sources');

    fireEvent.pointerDown(sourcesButton);
    fireEvent.mouseDown(sourcesButton);
    fireEvent.click(sourcesButton);

    expect(sourcesButton).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes an open bubble when the page scrolls', () => {
    renderNav();
    const sourcesButton = getNavButton('Sources');

    fireEvent.pointerDown(sourcesButton);
    fireEvent.click(sourcesButton);
    expect(sourcesButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.scroll(window);
    expect(sourcesButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('handles filter, time, and search interactions from the nav', () => {
    const onToggleRecent = vi.fn();
    const onToggleFilter = vi.fn();
    const onSearchChange = vi.fn();
    const onSearchClear = vi.fn();

    renderNav({
      activeFilters: { sourceIds: ['s1'], topics: ['tech'] },
      showRecentOnly: true,
      search: 'query',
      onToggleRecent,
      onToggleFilter,
      onSearchChange,
      onSearchClear,
    });

    expect(getNavButton('Sources')).toHaveTextContent('1');
    expect(getNavButton('Topics')).toHaveTextContent('1');

    fireEvent.click(getNavButton('Last 3 hours'));
    expect(onToggleRecent).toHaveBeenCalled();

    fireEvent.click(getNavButton('Sources'));
    fireEvent.click(screen.getByText('BBC'));
    expect(onToggleFilter).toHaveBeenCalledWith('sourceIds', 's1');

    fireEvent.click(getNavButton('Search'));
    const input = screen.getByPlaceholderText('Search...');
    fireEvent.change(input, { target: { value: 'news' } });
    expect(onSearchChange).toHaveBeenCalledWith('news');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSearchClear).toHaveBeenCalled();
    expect(getNavButton('Sources')).toBeInTheDocument();
  });
});
