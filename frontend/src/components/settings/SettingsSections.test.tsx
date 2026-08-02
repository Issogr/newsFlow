import { fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from '../../i18n';
import SettingsCustomSourcesSection from './SettingsCustomSourcesSection';
import SettingsExclusionsSection from './SettingsExclusionsSection';

const t = createTranslator('en');

test('reveals the custom source form only after Add source is selected', () => {
  const onSourceFormChange = vi.fn();
  const { container } = render(
    <SettingsCustomSourcesSection
      t={t}
      saving={false}
      sourceError={null}
      customSources={[]}
      sourceForm={{ url: '' }}
      editingSourceId=""
      editingSourceForm={{ name: '', url: '', language: 'en' }}
      onSourceFormChange={onSourceFormChange}
      onEditingSourceFormChange={vi.fn()}
      onAddSource={vi.fn()}
      onStartEditSource={vi.fn()}
      onCancelEditSource={vi.fn()}
      onUpdateSource={vi.fn()}
      onDeleteSource={vi.fn()}
    />
  );

  const summary = container.querySelector('summary');
  const details = summary!.closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByLabelText('Feed URL')).not.toBeVisible();

  fireEvent.click(summary!);

  expect(details).toHaveAttribute('open');
  expect(screen.getByLabelText('Feed URL')).toBeVisible();

  fireEvent.change(screen.getByLabelText('Feed URL'), { target: { value: 'https://example.com/feed.xml' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(details).not.toHaveAttribute('open');
  expect(summary).toHaveFocus();
  expect(onSourceFormChange).toHaveBeenLastCalledWith({ url: '' });
});

test('reveals sub-feeds only when their visible parent is expanded', () => {
  const source = {
    id: 'source-1',
    name: 'Example',
    subSources: [
      { id: 'sub-1', label: 'Top stories' },
      { id: 'sub-2', label: 'Local news' }
    ]
  };

  render(
    <SettingsExclusionsSection
      t={t}
      saving={false}
      settings={{ excludedSourceIds: [], excludedSubSourceIds: [] }}
      excludedSourceCatalog={[source]}
      onToggleSource={vi.fn()}
      onToggleSubFeed={vi.fn()}
    />
  );

  expect(screen.queryByText('Top stories')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Choose feeds from Example' }));
  expect(screen.getByText('Top stories')).toBeInTheDocument();
});

test('does not count a source with every sub-feed hidden as visible', () => {
  const source = {
    id: 'source-1',
    name: 'Example',
    subSources: [
      { id: 'sub-1', label: 'Top stories' },
      { id: 'sub-2', label: 'Local news' }
    ]
  };

  render(
    <SettingsExclusionsSection
      t={t}
      saving={false}
      settings={{ excludedSourceIds: [], excludedSubSourceIds: ['sub-1', 'sub-2'] }}
      excludedSourceCatalog={[source]}
      onToggleSource={vi.fn()}
      onToggleSubFeed={vi.fn()}
    />
  );

  expect(screen.getByText('0 of 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Example' })).toHaveAttribute('aria-pressed', 'false');
});

test('moves focus to the parent before hiding its final visible sub-feed', () => {
  const source = {
    id: 'source-1',
    name: 'Example',
    subSources: [
      { id: 'sub-1', label: 'Top stories' },
      { id: 'sub-2', label: 'Local news' }
    ]
  };
  let rerender!: ReturnType<typeof render>['rerender'];
  const onToggleSubFeed = () => {
    rerender(
      <SettingsExclusionsSection
        t={t}
        saving={false}
        settings={{ excludedSourceIds: ['source-1'], excludedSubSourceIds: [] }}
        excludedSourceCatalog={[source]}
        onToggleSource={vi.fn()}
        onToggleSubFeed={onToggleSubFeed}
      />
    );
  };
  ({ rerender } = render(
    <SettingsExclusionsSection
      t={t}
      saving={false}
      settings={{ excludedSourceIds: [], excludedSubSourceIds: ['sub-1'] }}
      excludedSourceCatalog={[source]}
      onToggleSource={vi.fn()}
      onToggleSubFeed={onToggleSubFeed}
    />
  ));

  fireEvent.click(screen.getByRole('button', { name: 'Choose feeds from Example' }));
  const finalSubFeed = screen.getByRole('button', { name: 'Local news' });
  finalSubFeed.focus();
  fireEvent.click(finalSubFeed);

  expect(screen.getByRole('button', { name: 'Example' })).toHaveFocus();
});
