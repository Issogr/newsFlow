import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

jest.mock('./services/api', () => ({
  fetchCurrentUser: jest.fn(),
  getAuthToken: jest.fn(),
  loginUser: jest.fn(),
  logoutUser: jest.fn(),
  registerUser: jest.fn(),
  setAuthToken: jest.fn(),
  updateUserSettings: jest.fn()
}));

jest.mock('./components/NewsAggregator', () => ({ onOpenReleaseNotes }) => (
  <div>
    <div>Authenticated app</div>
    <button type="button" onClick={onOpenReleaseNotes}>Open release notes</button>
  </div>
));

const {
  fetchCurrentUser,
  getAuthToken,
  setAuthToken,
  updateUserSettings
} = require('./services/api');

function createCurrentUser(settings = {}) {
  return {
    user: { username: 'alice' },
    settings: {
      defaultLanguage: 'en',
      articleRetentionHours: 24,
      recentHours: 3,
      autoRefreshEnabled: true,
      readerPanelPosition: 'right',
      lastSeenReleaseNotesVersion: '',
      excludedSourceIds: [],
      excludedSubSourceIds: [],
      ...settings
    },
    limits: {
      articleRetentionHoursMax: 24,
      recentHoursMax: 3
    },
    customSources: []
  };
}

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
  });

  test('renders the authentication screen when there is no saved session', () => {
    getAuthToken.mockReturnValue('');

    render(<App />);

    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(fetchCurrentUser).not.toHaveBeenCalled();
  });

  test('renders the authenticated app when the current session loads', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.1' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
  });

  test('shows release notes once after login for users who have not seen the current update', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser());
    updateUserSettings.mockResolvedValue({
      success: true,
      settings: createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.1' }).settings
    });

    render(<App />);

    expect(await screen.findByText('What is new')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Got it' })[0]);

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith({ lastSeenReleaseNotesVersion: '3.2.1' });
    });
  });

  test('reopens release notes manually from the authenticated app', async () => {
    getAuthToken.mockReturnValue('session-token');
    fetchCurrentUser.mockResolvedValue(createCurrentUser({ lastSeenReleaseNotesVersion: '3.2.1' }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }));

    expect(await screen.findByText('What is new')).toBeInTheDocument();
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
});
