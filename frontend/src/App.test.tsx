import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { CURRENT_CHANGELOG_ENTRY } from './config/changelog';
import { createTestCurrentUser } from './test-utils/currentUser';
import {
  AUTH_EXPIRED_EVENT,
  completePasswordSetup as completePasswordSetupImplementation,
  fetchCurrentUser as fetchCurrentUserImplementation,
  updateUserSettings as updateUserSettingsImplementation,
  validatePasswordSetupToken as validatePasswordSetupTokenImplementation
} from './services/api';
import type { CurrentUser, Locale, Translator } from './types';

const CURRENT_CHANGELOG_ID = 'a'.repeat(40);
const CURRENT_CHANGELOG_URL = `https://github.com/issogr/newsflow/releases/tag/update-${CURRENT_CHANGELOG_ID}`;
const originalChangelogMetadata = { id: CURRENT_CHANGELOG_ENTRY.id, date: CURRENT_CHANGELOG_ENTRY.date, url: CURRENT_CHANGELOG_ENTRY.url };

vi.mock('./services/api', () => ({
  AUTH_EXPIRED_EVENT: 'newsflow:auth-expired',
  completePasswordSetup: vi.fn(),
  fetchCurrentUser: vi.fn(),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
  registerUser: vi.fn(),
  updateUserSettings: vi.fn(),
  validatePasswordSetupToken: vi.fn()
}));

const completePasswordSetup = vi.mocked(completePasswordSetupImplementation);
const fetchCurrentUser = vi.mocked(fetchCurrentUserImplementation);
const updateUserSettings = vi.mocked(updateUserSettingsImplementation);
const validatePasswordSetupToken = vi.mocked(validatePasswordSetupTokenImplementation);

vi.mock('./components/NewsAggregator', () => ({
  default: ({ currentUser, locale, t, onOpenReleaseNotes, patchSession }: { currentUser: CurrentUser; locale: Locale; t: Translator; onOpenReleaseNotes: () => void; patchSession: (patch: Record<string, unknown>) => void }) => (
    <div>
      <div>Authenticated app</div>
      <div data-testid="active-locale">{locale}: {t('settings')}</div>
      <div>Session fields: {currentUser.apiToken?.id || 'none'}, {currentUser.customSources?.length || 0} sources</div>
      <button type="button" onClick={onOpenReleaseNotes}>Open release notes</button>
      <button
        type="button"
        onClick={() => patchSession({ settings: { ...currentUser.settings, sourceSetupCompleted: true } })}
      >
        Complete source setup
      </button>
      <button
        type="button"
        onClick={() => patchSession({ settings: { ...currentUser.settings, defaultLanguage: 'it' } })}
      >
        Switch locale
      </button>
      <button
        type="button"
        onClick={() => {
          patchSession({ apiToken: { id: 'token-1' } });
          patchSession({ customSources: [{ id: 'source-1' }] });
        }}
      >
        Patch session fields
      </button>
    </div>
  )
}));

vi.mock('./components/AdminDashboard', () => ({
  default: ({ currentUser }: { currentUser: CurrentUser }) => <div>Admin dashboard for {currentUser?.user?.username}</div>
}));

describe('App', () => {
  beforeEach(() => {
    Object.assign(CURRENT_CHANGELOG_ENTRY, { id: CURRENT_CHANGELOG_ID, date: '2026-09-21', url: CURRENT_CHANGELOG_URL });
    vi.useRealTimers();
    window.localStorage.clear();
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
    document.documentElement.lang = '';
    window.history.replaceState({}, '', '/');
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
  });

  afterEach(() => {
    Object.assign(CURRENT_CHANGELOG_ENTRY, originalChangelogMetadata);
    vi.useRealTimers();
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
    document.documentElement.lang = '';
  });

  test('renders the admin dashboard instead of the news home for admin sessions', async () => {
    fetchCurrentUser.mockResolvedValue({
      ...createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: '3.2.5' } }),
      user: { username: 'admin', isAdmin: true }
    });

    render(<App />);

    expect(await screen.findByText('Admin dashboard for admin')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
  });

  test('applies the selected dark theme to the document root after session load', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { themeMode: 'dark', lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
  });

  test('owns locale side effects and updates translations after settings change', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));

    render(<App />);

    expect(await screen.findByTestId('active-locale')).toHaveTextContent('en: Settings');
    await waitFor(() => {
      expect(window.localStorage.getItem('newsflow-locale')).toBe('en');
      expect(document.documentElement.lang).toBe('en');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch locale' }));

    await waitFor(() => {
      expect(screen.getByTestId('active-locale')).toHaveTextContent('it: Impostazioni');
      expect(window.localStorage.getItem('newsflow-locale')).toBe('it');
      expect(document.documentElement.lang).toBe('it');
    });
  });

  test('merges consecutive top-level session patches', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));

    render(<App />);

    expect(await screen.findByText('Session fields: none, 0 sources')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Patch session fields' }));

    expect(await screen.findByText('Session fields: token-1, 1 sources')).toBeInTheDocument();
  });

  test.each(['', '3.7.0', '2026-09-21-01'])('announces the new ID after acknowledgement %j and saves it after reading', async (lastSeenReleaseNotesVersion) => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion } }));
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();
    expect(screen.getByText('September 21, 2026')).toHaveAttribute('datetime', '2026-09-21');
    expect(screen.queryByText(CURRENT_CHANGELOG_ID)).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByText('What is new')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Update released'));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'What is new' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('link', { name: 'Read full changelog on GitHub' })).toHaveAttribute('href', CURRENT_CHANGELOG_URL);
    expect(document.body.style.overflow).toBe('hidden');
    expect(updateUserSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID });
      expect(document.body.style.overflow).toBe('');
    });
  });

  test.each([
    {
      name: 'auto-dismisses after 30 seconds',
      useFakeTimers: true,
      dismiss: async () => {
        await act(async () => {
          vi.advanceTimersByTime(30000);
        });
      }
    },
    {
      name: 'dismisses with the close button',
      useFakeTimers: false,
      dismiss: async () => {
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: 'Close update notice' }));
        });
      }
    }
  ])('$name and persists the current changelog ID', async ({ useFakeTimers, dismiss }) => {
    if (useFakeTimers) {
      vi.useFakeTimers();
    }
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();

    await dismiss();

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID });
    });

    expect(screen.queryByText('Update released')).not.toBeInTheDocument();
  });

  test('reopens release notes manually from the authenticated app', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(screen.queryByText('Update released')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
  });

  test('links local builds to release history without announcing or acknowledging an unpublished update', async () => {
    Object.assign(CURRENT_CHANGELOG_ENTRY, { id: 'unreleased', date: '', url: 'https://github.com/issogr/newsflow/releases' });
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(screen.queryByText('Update released')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }));
    expect(await screen.findByText('Unreleased')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read full changelog on GitHub' })).toHaveAttribute('href', 'https://github.com/issogr/newsflow/releases');
    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  test('localizes the update date without changing its acknowledgement ID', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { defaultLanguage: 'it' } }));
    updateUserSettings.mockResolvedValue({
      settings: createTestCurrentUser({ settings: { defaultLanguage: 'it', lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }).settings
    });

    render(<App />);

    expect(await screen.findByText('21 settembre 2026')).toHaveAttribute('datetime', '2026-09-21');
    fireEvent.click(screen.getByText('Aggiornamento disponibile'));
    expect(await screen.findByRole('link', { name: 'Leggi il changelog completo su GitHub' })).toHaveAttribute('href', CURRENT_CHANGELOG_URL);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ho capito' })[0]);
    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID });
    });
  });

  test('defers release prompts until mandatory source setup is complete', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { sourceSetupCompleted: false } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(screen.queryByText('Update released')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Complete source setup' }));

    expect(await screen.findByText('Update released')).toBeInTheDocument();
  });

  test('falls back to the authentication screen when loading the session fails', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });

  });

  test('returns to the authentication screen immediately after an auth-expired event', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    });

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });
  });

  test('shows a retryable error instead of logout during a session service outage', async () => {
    fetchCurrentUser
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));

    render(<App />);

    expect(await screen.findByText('Unable to load your session')).toBeInTheDocument();
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(fetchCurrentUser).toHaveBeenCalledTimes(2);
  });

  test('renders the password setup screen on setup routes', async () => {
    validatePasswordSetupToken.mockResolvedValue({
      username: 'admin',
      isAdmin: true,
      purpose: 'admin-bootstrap',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });
    completePasswordSetup.mockResolvedValue({
      user: { id: 'admin-id', username: 'admin', isAdmin: true },
      settings: createTestCurrentUser().settings,
      limits: createTestCurrentUser().limits,
      customSources: []
    });
    window.history.replaceState({}, '', '/admin/setup#token=bootstrap-token');

    render(<App />);

    expect(await screen.findByText('Set up admin access')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });

  test.each([
    ['/privacy-policy/', 'Privacy Policy'],
    ['/cookie-policy/', 'Cookie Policy']
  ])('renders legal policy route %s without loading a session', async (path, title) => {
    window.history.replaceState({}, '', path);

    render(<App />);

    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });

  test('loads the session when navigating from a public route to the app route', async () => {
    let resolveSession!: (user: CurrentUser) => void;
    fetchCurrentUser.mockImplementation(() => new Promise<CurrentUser>((resolve) => {
      resolveSession = resolve;
    }));
    window.history.replaceState({}, '', '/privacy-policy');

    render(<App />);

    expect(await screen.findByText('Privacy Policy')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();

    await act(async () => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new Event('popstate'));
    });

    await waitFor(() => {
      expect(fetchCurrentUser).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();

    await act(async () => {
      resolveSession(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_CHANGELOG_ID } }));
    });

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
  });

  test('renders the API docs page on the moved docs route without loading a session', async () => {
    window.history.replaceState({}, '', '/api/docs');

    render(<App />);

    expect(await screen.findByText('External News API')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });
});
