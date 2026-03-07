import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';

jest.mock('./services/api', () => ({
  fetchCurrentUser: jest.fn(),
  getAuthToken: jest.fn(),
  loginUser: jest.fn(),
  logoutUser: jest.fn(),
  registerUser: jest.fn(),
  setAuthToken: jest.fn()
}));

jest.mock('./components/NewsAggregator', () => () => <div>Authenticated app</div>);

const {
  fetchCurrentUser,
  getAuthToken,
  setAuthToken
} = require('./services/api');

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
    fetchCurrentUser.mockResolvedValue({
      user: { username: 'alice' },
      settings: {
        defaultLanguage: 'en',
        articleRetentionHours: 24,
        recentHours: 3,
        hiddenSourceIds: []
      },
      limits: {
        articleRetentionHoursMax: 24,
        recentHoursMax: 3
      },
      customSources: []
    });

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
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
