import { fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from '../../i18n';
import SettingsCustomSourcesSection from './SettingsCustomSourcesSection';
import SettingsExclusionsSection from './SettingsExclusionsSection';

const t = createTranslator('en');

test('shows custom source discovery without an extra disclosure', () => {
  render(
    <SettingsCustomSourcesSection
      t={t}
      saving={false}
      sourceError={null}
      customSources={[]}
      editingSourceId=""
      editingSourceForm={{ name: '', url: '', language: 'en' }}
      onEditingSourceFormChange={vi.fn()}
      onAddDiscoveredSources={vi.fn()}
      onStartEditSource={vi.fn()}
      onCancelEditSource={vi.fn()}
      onUpdateSource={vi.fn()}
      onDeleteSource={vi.fn()}
    />
  );

  expect(screen.getByLabelText('Website URL')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Add source' })).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText('https://example.com/feed.xml')).not.toBeInTheDocument();
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
