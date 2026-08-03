import { fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator } from '../i18n';
import MobileBottomNav from './MobileBottomNav';
import type { ComponentProps } from 'react';

const t = createTranslator('en');

function renderNav(overrides: Partial<ComponentProps<typeof MobileBottomNav>> = {}) {
  const defaults: ComponentProps<typeof MobileBottomNav> = {
    visibleSources: [
      { id: 's1', name: 'BBC', count: 5 },
      { id: 's2', name: 'CNN', count: 3 },
    ],
    availableTopics: [
      { topic: 'tech', count: 4 },
      { topic: 'sport', count: 2 },
    ],
    activeFilters: { sourceIds: [], topics: [] },
    search: '',
    t,
    locale: 'en',
    onRefresh: vi.fn(),
    onClearFilter: vi.fn(),
    onToggleFilter: vi.fn(),
    onSearchChange: vi.fn(),
    onSearchClear: vi.fn(),
    onBackToTop: vi.fn(),
    visible: true,
  };
  return render(<MobileBottomNav {...defaults} {...overrides} />);
}

function getNavButton(name: string) {
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

  it('handles filter and search interactions from the nav', () => {
    const onClearFilter = vi.fn();
    const onToggleFilter = vi.fn();
    const onRefresh = vi.fn();
    const onSearchChange = vi.fn();
    const onSearchClear = vi.fn();

    renderNav({
      activeFilters: { sourceIds: ['s1'], topics: ['tech'] },
      search: 'query',
      onClearFilter,
      onRefresh,
      onToggleFilter,
      onSearchChange,
      onSearchClear,
    });

    expect(getNavButton('Sources')).toHaveTextContent('1');
    expect(getNavButton('Topics')).toHaveTextContent('1');
    const navButtons = within(screen.getByRole('navigation')).getAllByRole('button');
    const refreshButton = within(screen.getByRole('navigation')).getByRole('button', { name: 'Refresh' });
    expect(navButtons.indexOf(refreshButton)).toBe(2);

    fireEvent.click(refreshButton);
    expect(onRefresh).toHaveBeenCalled();

    fireEvent.click(getNavButton('Sources'));
    expect(screen.getByRole('heading', { name: 'Filter by source' })).toBeInTheDocument();
    expect(screen.getByLabelText('Selected: 1')).toHaveTextContent('1');
    const selectedSource = screen.getByRole('button', { name: /BBC/ });
    expect(selectedSource).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(selectedSource);
    expect(onToggleFilter).toHaveBeenCalledWith('sourceIds', 's1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear selected sources' }));
    expect(onClearFilter).toHaveBeenCalledWith('sourceIds');

    fireEvent.click(getNavButton('Topics'));
    expect(screen.getByRole('heading', { name: 'Filter by topic' })).toBeInTheDocument();
    const selectedTopic = screen.getByRole('button', { name: /Technology/ });
    expect(selectedTopic).toHaveAttribute('aria-pressed', 'true');
    expect(selectedTopic).toHaveClass('bg-emerald-600');

    fireEvent.click(getNavButton('Search'));
    const input = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(input, { target: { value: 'news' } });
    expect(onSearchChange).toHaveBeenCalledWith('news');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSearchClear).toHaveBeenCalled();
    expect(getNavButton('Sources')).toBeInTheDocument();
  });

  it('keeps back to top available while the navbar is collapsed', () => {
    const onBackToTop = vi.fn();

    renderNav({ visible: false, backToTopVisible: true, onBackToTop });

    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));

    expect(onBackToTop).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Back to top' })).toHaveClass('w-[3.95rem]');
    expect(screen.getByRole('navigation').querySelector('.mobile-nav-liquid')).toHaveClass(
      'mobile-nav-liquid-with-button',
      'mobile-nav-liquid-hidden'
    );
  });
});
