import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import {
  AUTH_EXPIRED_EVENT,
  completePasswordSetup,
  fetchCurrentUser,
  updateUserSettings,
  validatePasswordSetupToken
} from './services/api';

vi.mock('./services/api', () => ({
  AUTH_EXPIRED_EVENT: 'newsflow:auth-expired',
  completePasswordSetup: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchAdminUsers: vi.fn(),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
  createAdminPasswordSetupLink: vi.fn(),
  registerUser: vi.fn(),
  updateUserSettings: vi.fn(),
  validatePasswordSetupToken: vi.fn()
}));

vi.mock('./components/NewsAggregator', () => ({
  default: ({ onOpenReleaseNotes }) => (
    <div>
      <div>Authenticated app</div>
      <button type="button" onClick={onOpenReleaseNotes}>Open release notes</button>
    </div>
  )
}));

vi.mock('./components/AdminDashboard', () => ({
  default: ({ currentUser }) => <div>Admin dashboard for {currentUser?.user?.username}</div>
}));

function createCurrentUser(settings = {}) {
  return {
    user: { username: 'alice', isAdmin: false },
    settings: {
      defaultLanguage: 'en',
      themeMode: 'system',
      articleRetentionHours: 24,
      recentHours: 3,
      showNewsImages: true,
      compactNewsCards: false,
      compactNewsCardsMode: 'off',
      readerPanelPosition: 'right',
      readerTextSize: 'medium',
      lastSeenReleaseNotesVersion: '',
      excludedSourceIds: [],
      excludedSubSourceIds: [],
      ...settings
    },
    limits: {
      articleRetentionHoursMax: 24,
      recentHoursMax: 3,
      apiTokenTtlDays: 30
    },
    customSources: [],
    apiToken: null
  };
}

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
    window.history.replaceState({}, '', '/');
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
  });

  test('renders the authenticated app when the current session loads', async () => {
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.13.4' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
  });

  test('renders the admin dashboard instead of the news home for admin sessions', async () => {
    fetchCurrentUser.mockResolvedValue({
      ...createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.5' }),
      user: { username: 'admin', isAdmin: true }
    });

    render(<App />);

    expect(await screen.findByText('Admin dashboard for admin')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
  });

  test('applies the selected dark theme to the document root after session load', async () => {
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ themeMode: 'dark', lastSeenReleaseNotesVersion: '3.2.13.4' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  test('shows an update notice after login and persists the version only after the changelog modal is dismissed', async () => {
    fetchCurrentUser.mockResolvedValue(createCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.13.4' }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();
    expect(screen.queryByText('What is new')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Update released'));

    expect(await screen.findByText('What is new')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: '3.2.13.4' });
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
        fireEvent.click(screen.getByRole('button', { name: 'Close update notice' }));
      }
    }
  ])('$name and persists the current version', async ({ useFakeTimers, dismiss }) => {
    if (useFakeTimers) {
      vi.useFakeTimers();
    }
    fetchCurrentUser.mockResolvedValue(createCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.13.4' }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();

    await dismiss();

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: '3.2.13.4' });
    });

    expect(screen.queryByText('Update released')).not.toBeInTheDocument();
  });

  test('reopens release notes manually from the authenticated app', async () => {
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.13.4' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
  });

  test('locks body scroll while release notes are open', async () => {
    fetchCurrentUser.mockResolvedValue(createCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.13.4' }).settings
    });

    render(<App />);

    expect(await screen.findByText('Update released')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');

    fireEvent.click(screen.getByText('Update released'));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
    });
  });

  test('falls back to the authentication screen when loading the session fails', async () => {
    fetchCurrentUser.mockRejectedValue(new Error('Session expired'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });

  });

  test('returns to the authentication screen immediately after an auth-expired event', async () => {
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.13.4' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();

    window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });
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
      settings: createCurrentUser().settings,
      limits: createCurrentUser().limits,
      customSources: []
    });
    window.history.replaceState({}, '', '/admin/setup#token=bootstrap-token');

    render(<App />);

    expect(await screen.findByText('Set up admin access')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });

  test('renders the privacy policy page without loading a session', async () => {
    window.history.replaceState({}, '', '/privacy-policy');

    render(<App />);

    expect(await screen.findByText('Privacy Policy')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });

  test('renders the API docs page on the moved docs route without loading a session', async () => {
    window.history.replaceState({}, '', '/api/docs');

    render(<App />);

    expect(await screen.findByText('External News API')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });
});
