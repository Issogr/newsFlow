import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import {
  completePasswordSetup,
  fetchCurrentUser,
  getAuthToken,
  setAuthToken,
  updateUserSettings,
  validatePasswordSetupToken
} from './services/api';

vi.mock('./services/api', () => ({
  completePasswordSetup: vi.fn(),
  fetchCurrentUser: vi.fn(),
  fetchAdminUsers: vi.fn(),
  getAuthToken: vi.fn(),
  loginUser: vi.fn(),
  logoutUser: vi.fn(),
  createAdminPasswordSetupLink: vi.fn(),
  registerUser: vi.fn(),
  setAuthToken: vi.fn(),
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
        autoRefreshEnabled: true,
        showNewsImages: true,
        compactNewsCards: false,
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
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
  });

  test('renders the authentication screen when there is no saved session', () => {
    getAuthToken.mockReturnValue('');

    render(<App />);

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });

  test('renders the authenticated app when the current session loads', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.9.1' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
  });

  test('renders the admin dashboard instead of the news home for admin sessions', async () => {
    getAuthToken.mockReturnValue('admin-token');
    fetchCurrentUser.mockResolvedValue({
      ...createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.5' }),
      user: { username: 'admin', isAdmin: true }
    });

    render(<App />);

    expect(await screen.findByText('Admin dashboard for admin')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
  });

  test('applies the selected dark theme to the document root after session load', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ themeMode: 'dark', lastSeenReleaseNotesVersion: '3.2.9.1' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  test('shows release notes once after login for users who have not seen the current update', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
        settings: createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.9.1' }).settings
    });

    render(<App />);

    expect(await screen.findByText('What is new')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: '3.2.9.1' });
    });
  });

  test('reopens release notes manually from the authenticated app', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.9.1' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
  });

  test('locks body scroll while release notes are open', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
        settings: createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.9.1' }).settings
    });

    render(<App />);

    expect(await screen.findByText('What is new')).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(document.body.style.overflow).toBe('');
    });
  });

  test('falls back to the authentication screen when loading the session fails', async () => {
    getAuthToken.mockReturnValue('stale-token');
    fetchCurrentUser.mockRejectedValue(new Error('Session expired'));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });

    expect(setAuthToken).toHaveBeenCalledWith('');
  });

  test('renders the password setup screen on setup routes', async () => {
    getAuthToken.mockReturnValue('');
    validatePasswordSetupToken.mockResolvedValue({
      username: 'admin',
      isAdmin: true,
      purpose: 'admin-bootstrap',
      expiresAt: '2026-03-27T12:00:00.000Z'
    });
    completePasswordSetup.mockResolvedValue({
      token: 'session-token',
      user: { id: 'admin-id', username: 'admin', isAdmin: true },
      settings: createCurrentUser().settings,
      limits: createCurrentUser().limits,
      customSources: []
    });
    window.history.replaceState({}, '', '/admin/setup?token=bootstrap-token');

    render(<App />);

    expect(await screen.findByText('Set up admin access')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });
});
