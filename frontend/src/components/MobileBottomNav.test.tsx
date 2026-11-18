import { fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator } from '../i18n';
import MobileBottomNav from './MobileBottomNav';
import type { ComponentProps } from 'react';

const t = createTranslator('en');

function renderNav(overrides: Partial<ComponentProps<typeof MobileBottomNav>> = {}) {
  return render(<MobileBottomNav filtersOpen={false} filterCount={0} onOpenFilters={vi.fn()} search="" t={t} activeView="news" onViewChange={vi.fn()}
    onSearchChange={vi.fn()} onSearchClear={vi.fn()} {...overrides} />);
}

describe('MobileBottomNav', () => {
  it('opens the shared filters panel and keeps search independent', () => {
    const onOpenFilters = vi.fn();
    const onSearchChange = vi.fn();
    const onSearchClear = vi.fn();
    const onViewChange = vi.fn();
    renderNav({ filterCount: 2, onOpenFilters, onSearchChange, onSearchClear, onViewChange });
    const filters = screen.getByRole('button', { name: /Filters/ });
    const nav = within(screen.getByRole('navigation'));
    const latest = nav.getByRole('button', { name: 'Latest' });
    const saved = nav.getByRole('button', { name: 'Saved' });
    expect(nav.getAllByRole('button')).toEqual([latest, saved, filters, nav.getByRole('button', { name: 'Search' })]);
    expect(latest).toHaveAttribute('aria-pressed', 'true');
    expect(saved).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(saved);
    expect(onViewChange).toHaveBeenCalledWith('readLater');
    fireEvent.click(latest);
    expect(onViewChange).toHaveBeenCalledWith('news');
    expect(filters).toHaveTextContent('2');
    expect(filters).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(filters);
    expect(onOpenFilters).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.queryByRole('button', { name: /Filters/ })).not.toBeInTheDocument();
    const input = screen.getByRole('searchbox', { name: 'Search' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'news' } });
    expect(onSearchChange).toHaveBeenCalledWith('news');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSearchClear).toHaveBeenCalledOnce();
    expect(filters).toBeVisible();
  });

  it('keeps back to top available while the navbar is collapsed', () => {
    const onBackToTop = vi.fn();
    renderNav({ visible: false, backToTopVisible: true, onBackToTop });
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));
    expect(onBackToTop).toHaveBeenCalledOnce();
    expect(within(screen.getByRole('navigation')).queryByRole('button', { name: 'Latest' })).not.toBeInTheDocument();
  });
});
