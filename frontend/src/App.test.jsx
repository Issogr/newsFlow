import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { CURRENT_CHANGELOG_ENTRY } from './config/changelog';
import { createTestCurrentUser } from './test-utils/currentUser';
import {
  AUTH_EXPIRED_EVENT,
  completePasswordSetup,
  fetchCurrentUser,
  updateUserSettings,
  validatePasswordSetupToken
} from './services/api';

const CURRENT_RELEASE_VERSION = CURRENT_CHANGELOG_ENTRY.version;

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

vi.mock('./components/NewsAggregator', () => ({
  default: ({ currentUser, onOpenReleaseNotes, onUserUpdate }) => (
    <div>
      <div>Authenticated app</div>
      <button type="button" onClick={onOpenReleaseNotes}>Open release notes</button>
      <button
        type="button"
        onClick={() => onUserUpdate({
          ...currentUser,
          settings: { ...currentUser.settings, sourceSetupCompleted: true }
        })}
      >
        Complete source setup
      </button>
    </div>
  )
}));

vi.mock('./components/AdminDashboard', () => ({
  default: ({ currentUser }) => <div>Admin dashboard for {currentUser?.user?.username}</div>
}));

describe('App', () => {
  beforeEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
    window.history.replaceState({}, '', '/');
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
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
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { themeMode: 'dark', lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
  });

  test('shows an update notice after login and persists the version only after the changelog modal is dismissed', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(screen.queryByText('What is new')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Update released'));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'What is new' })).toHaveAttribute('aria-modal', 'true');
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION });
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
  ])('$name and persists the current version', async ({ useFakeTimers, dismiss }) => {
    if (useFakeTimers) {
      vi.useFakeTimers();
    }
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();

    await dismiss();

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION });
    });

    expect(screen.queryByText('Update released')).not.toBeInTheDocument();
  });

  test('reopens release notes manually from the authenticated app', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
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
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }));

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
      .mockResolvedValueOnce(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }));

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
    let resolveSession;
    fetchCurrentUser.mockImplementation(() => new Promise((resolve) => {
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
      resolveSession(createTestCurrentUser({ settings: { lastSeenReleaseNotesVersion: CURRENT_RELEASE_VERSION } }));
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
