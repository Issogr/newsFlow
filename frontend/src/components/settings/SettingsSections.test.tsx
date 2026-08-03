import { fireEvent, render, screen } from '@testing-library/react';
import { createTranslator } from '../../i18n';
import SettingsCustomSourcesSection from './SettingsCustomSourcesSection';
import SettingsExclusionsSection from './SettingsExclusionsSection';

const t = createTranslator('en');
const sourceManagementProps = {
  customSources: [],
  pendingDeletedSourceIds: [],
  sourceError: null,
  editingSourceId: '',
  editingSourceForm: { name: '', url: '', language: 'en' },
  onEditingSourceFormChange: vi.fn(),
  onStartEditSource: vi.fn(),
  onCancelEditSource: vi.fn(),
  onDeleteSource: vi.fn()
};

test('shows custom source discovery without an extra disclosure', () => {
  render(
    <SettingsCustomSourcesSection
      t={t}
      saving={false}
      sourceError={null}
      customSources={[]}
      onAddDiscoveredSources={vi.fn()}
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
      {...sourceManagementProps}
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
      {...sourceManagementProps}
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
        {...sourceManagementProps}
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
      {...sourceManagementProps}
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

test('shows edit and remove controls only for custom RSS sources', () => {
  const onStartEditSource = vi.fn();
  const builtInSource = { id: 'source-1', name: 'Built-in News' };
  const customSource = { id: 'custom-1', name: 'Personal RSS', url: 'https://example.com/feed.xml' };

  render(
    <SettingsExclusionsSection
      t={t}
      saving={false}
      settings={{ excludedSourceIds: [], excludedSubSourceIds: [] }}
      excludedSourceCatalog={[builtInSource]}
      {...sourceManagementProps}
      customSources={[customSource]}
      onStartEditSource={onStartEditSource}
      onToggleSource={vi.fn()}
      onToggleSubFeed={vi.fn()}
    />
  );

  expect(screen.getByText('Manage News Sources')).toBeInTheDocument();
  expect(screen.getByText('2 of 2')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Edit source' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: 'Edit source' }));
  expect(onStartEditSource).toHaveBeenCalledWith(customSource);
});

test('deduplicates grouped RSS sources and sorts active sources by name first', () => {
  const customSource = { id: 'custom-1', name: 'Personal RSS', url: 'https://example.com/feed.xml' };

  render(
    <SettingsExclusionsSection
      t={t}
      saving={false}
      settings={{ excludedSourceIds: ['source-zulu'], excludedSubSourceIds: [] }}
      excludedSourceCatalog={[
        { id: 'source-zulu', name: 'Zulu News' },
        { id: 'example.com', name: 'Personal RSS', subSources: [{ id: 'custom-1', name: 'Personal RSS' }] },
        { id: 'source-alpha', name: 'Alpha News' }
      ]}
      {...sourceManagementProps}
      customSources={[customSource]}
      onToggleSource={vi.fn()}
      onToggleSubFeed={vi.fn()}
    />
  );

  const alphaSource = screen.getByRole('button', { name: 'Alpha News' });
  const customSourceButton = screen.getByRole('button', { name: 'Personal RSS' });
  const inactiveSource = screen.getByRole('button', { name: 'Zulu News' });
  const editButton = screen.getByRole('button', { name: 'Edit source' });

  expect(screen.getAllByRole('button', { name: 'Personal RSS' })).toHaveLength(1);
  expect(alphaSource.compareDocumentPosition(customSourceButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(customSourceButton.compareDocumentPosition(inactiveSource) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(editButton.parentElement).toBe(customSourceButton.parentElement);
  expect(screen.getByText('2 of 3')).toBeInTheDocument();
});
