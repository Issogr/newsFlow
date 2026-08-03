import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';
import { createTranslator } from '../i18n';
import { addUserSource as addUserSourceImplementation, deleteUserSource as deleteUserSourceImplementation, discoverRssFeeds as discoverRssFeedsImplementation, updateUserSettings as updateUserSettingsImplementation } from '../services/api';
import { createTestCurrentUser } from '../test-utils/currentUser';
import type { ComponentProps } from 'react';
import type { UserSettings } from '../types';

vi.mock('../services/api', () => ({
  addUserSource: vi.fn(),
  createApiToken: vi.fn(),
  deleteUserSource: vi.fn(),
  discoverRssFeeds: vi.fn(),
  exportUserSettings: vi.fn(),
  importUserSettings: vi.fn(),
  isRequestCanceled: vi.fn(() => false),
  revokeApiToken: vi.fn(),
  updateUserSource: vi.fn(),
  updateUserSettings: vi.fn()
}));

const addUserSource = vi.mocked(addUserSourceImplementation);
const deleteUserSource = vi.mocked(deleteUserSourceImplementation);
const discoverRssFeeds = vi.mocked(discoverRssFeedsImplementation);
const updateUserSettings = vi.mocked(updateUserSettingsImplementation);

const t = createTranslator('en');
const currentUser = createTestCurrentUser();

const renderPanel = (overrides: Partial<ComponentProps<typeof SettingsPanel>> = {}) => {
  const props: ComponentProps<typeof SettingsPanel> = {
    t,
    currentUser,
    availableSources: [],
    currentChangelogVersion: '3.5.11',
    onClose: vi.fn(),
    onOpenReleaseNotes: vi.fn(),
    patchSession: vi.fn(),
    ...overrides
  };

  render(<SettingsPanel {...props} />);
  return props;
};

describe('SettingsPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  test('offers save, discard, or continued editing when closing a draft', () => {
    const { onClose } = renderPanel();

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-describedby', 'unsaved-settings-message');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Back to edit' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('selects and adds multiple feeds discovered from a website', async () => {
    const sources = [
      { id: 'source-1', name: 'Example Feed', url: 'https://example.com/feed.xml', language: 'en' },
      { id: 'source-2', name: 'Example Atom', url: 'https://example.com/atom.xml', language: 'en' }
    ];
    discoverRssFeeds.mockResolvedValue({ feeds: sources.map(({ name: title, url }) => ({ title, url })) });
    addUserSource
      .mockResolvedValueOnce({ source: sources[0] })
      .mockResolvedValueOnce({ source: sources[1] });
    const { patchSession } = renderPanel({ view: 'feedNews' });

    expect(screen.getByRole('dialog', { name: 'Add Feed News' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find RSS feeds' }));

    const discoveredFeed = await screen.findByRole('button', { name: 'Select Example Feed' });
    expect(discoverRssFeeds).toHaveBeenCalledWith('https://example.com', { signal: expect.any(AbortSignal) });
    expect(addUserSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(discoveredFeed).not.toBeInTheDocument();
    expect(screen.getByLabelText('Website URL')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find RSS feeds' }));

    const refreshedFeed = await screen.findByRole('button', { name: 'Select Example Feed' });
    const refreshedAtom = screen.getByRole('button', { name: 'Select Example Atom' });
    fireEvent.click(refreshedFeed);
    fireEvent.click(refreshedAtom);
    expect(refreshedFeed).toHaveAttribute('aria-pressed', 'true');
    expect(refreshedAtom).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Add selected (2)' }));
    await waitFor(() => {
      expect(addUserSource).toHaveBeenNthCalledWith(1, { url: sources[0].url });
      expect(addUserSource).toHaveBeenNthCalledWith(2, { url: sources[1].url });
      expect(patchSession).toHaveBeenLastCalledWith({ customSources: [sources[1], sources[0]] });
    });
    expect(screen.queryByRole('button', { name: 'Deselect Example Feed' })).not.toBeInTheDocument();
  });

  test('reports when a website does not publish discoverable feeds', async () => {
    discoverRssFeeds.mockResolvedValue({ feeds: [] });
    renderPanel({ view: 'feedNews' });

    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find RSS feeds' }));

    expect(await screen.findByRole('status')).toHaveTextContent('No RSS or Atom feeds were found on this website.');
  });

  test('keeps feed discovery out of Settings and manages custom sources with the source catalog', () => {
    renderPanel({
      currentUser: createTestCurrentUser({
        customSources: [{ id: 'custom-1', name: 'Personal RSS', url: 'https://example.com/feed.xml', language: 'en' }]
      }),
      availableSources: [{ id: 'source-1', name: 'Built-in News' }]
    });

    expect(screen.queryByLabelText('Website URL')).not.toBeInTheDocument();
    expect(screen.getByText('Manage News Sources')).toBeInTheDocument();
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit source' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  });

  test('uses the existing save or discard reminder for a staged custom source removal', () => {
    const { onClose } = renderPanel({
      currentUser: createTestCurrentUser({
        customSources: [{ id: 'custom-1', name: 'Personal RSS', url: 'https://example.com/feed.xml', language: 'en' }]
      })
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(deleteUserSource).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('alertdialog', { name: 'Unsaved changes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(deleteUserSource).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('returns focus to settings when saving from the reminder fails', async () => {
    updateUserSettings.mockRejectedValue(new Error('Unable to save'));
    const { onClose } = renderPanel();

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    const closeButton = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeButton);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toContainElement(document.activeElement as HTMLElement | null);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('saves a draft from the close reminder', async () => {
    const nextSettings: UserSettings = { ...currentUser.settings, themeMode: 'dark' };
    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    const { onClose, patchSession } = renderPanel();

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateUserSettings).toHaveBeenCalledWith({ themeMode: 'dark' });
    expect(patchSession).toHaveBeenCalledWith(expect.objectContaining({ settings: nextSettings }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('saves the reader text width preference', async () => {
    const nextSettings: UserSettings = { ...currentUser.settings, readerTextWidth: 'widest' };
    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    renderPanel();

    fireEvent.change(screen.getByLabelText('Text width'), { target: { value: 'widest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ readerTextWidth: 'widest' });
    });
    expect(window.localStorage.getItem('news-flow-reader-text-width')).toBe('widest');
  });
});
