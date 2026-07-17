import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsPanel from './SettingsPanel';
import { createTranslator } from '../i18n';
import { addUserSource, updateUserSettings } from '../services/api';
import { createTestCurrentUser } from '../test-utils/currentUser';

vi.mock('../services/api', () => ({
  addUserSource: vi.fn(),
  createApiToken: vi.fn(),
  deleteUserSource: vi.fn(),
  exportUserSettings: vi.fn(),
  importUserSettings: vi.fn(),
  revokeApiToken: vi.fn(),
  updateUserSource: vi.fn(),
  updateUserSettings: vi.fn()
}));

const t = createTranslator('en');
const currentUser = createTestCurrentUser();

const renderPanel = (overrides = {}) => {
  const props = {
    t,
    currentUser,
    availableSources: [],
    currentChangelogVersion: '3.5.11',
    onClose: vi.fn(),
    onOpenReleaseNotes: vi.fn(),
    onUserUpdate: vi.fn(),
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

  test('saves a pending custom source from the close reminder', async () => {
    const source = {
      id: 'source-1',
      name: 'Example Feed',
      url: 'https://example.com/feed.xml',
      language: 'en'
    };
    addUserSource.mockResolvedValue({ source });
    const { onClose, onUserUpdate } = renderPanel();

    fireEvent.click(document.querySelector('summary'));
    fireEvent.change(screen.getByLabelText('Feed URL'), { target: { value: source.url } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(addUserSource).toHaveBeenCalledWith({ url: source.url });
      expect(onUserUpdate).toHaveBeenCalledWith(expect.objectContaining({ customSources: [source] }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
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
    expect(screen.getByRole('dialog', { name: 'Settings' })).toContainElement(document.activeElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  test('saves a draft from the close reminder', async () => {
    const nextSettings = { ...currentUser.settings, themeMode: 'dark' };
    updateUserSettings.mockResolvedValue({ settings: nextSettings });
    const { onClose, onUserUpdate } = renderPanel();

    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'dark' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateUserSettings).toHaveBeenCalledWith({ themeMode: 'dark' });
    expect(onUserUpdate).toHaveBeenCalledWith(expect.objectContaining({ settings: nextSettings }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('saves the reader text width preference', async () => {
    const nextSettings = { ...currentUser.settings, readerTextWidth: 'widest' };
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
