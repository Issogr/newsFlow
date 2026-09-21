import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { createTestCurrentUser } from './test-utils/currentUser';
import {
  AUTH_EXPIRED_EVENT,
  completePasswordSetup as completePasswordSetupImplementation,
  fetchCurrentUser as fetchCurrentUserImplementation,
  updateUserSettings as updateUserSettingsImplementation,
  validatePasswordSetupToken as validatePasswordSetupTokenImplementation
} from './services/api';
import type { CurrentUser, Locale, Translator } from './types';

vi.mock('./config/release.json', () => ({
  default: { id: 'a'.repeat(40), date: '2026-09-21', url: 'https://github.com/issogr/newsflow/releases' }
}));

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
  default: ({ currentUser, locale, t, patchSession }: { currentUser: CurrentUser; locale: Locale; t: Translator; patchSession: (patch: Record<string, unknown>) => void }) => (
    <div>
      <div>Authenticated app</div>
      <div data-testid="active-locale">{locale}: {t('settings')}</div>
      <div>Session fields: {currentUser.apiToken?.id || 'none'}, {currentUser.customSources?.length || 0} sources</div>
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
    document.body.style.overflow = '';
    document.documentElement.dataset.theme = '';
    document.documentElement.style.colorScheme = '';
    document.documentElement.lang = '';
  });

  test('renders the admin dashboard instead of the news home for admin sessions', async () => {
    fetchCurrentUser.mockResolvedValue({
      ...createTestCurrentUser(),
      user: { username: 'admin', isAdmin: true }
    });

    render(<App />);

    expect(await screen.findByText('Admin dashboard for admin')).toBeInTheDocument();
    expect(screen.queryByText('Authenticated app')).not.toBeInTheDocument();
  });

  test('applies the selected dark theme to the document root after session load', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser({ settings: { themeMode: 'dark' } }));

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.documentElement.dataset.theme).toBe('dark');
      expect(document.documentElement.style.colorScheme).toBe('dark');
    });
  });

  test('owns locale side effects and updates translations after settings change', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());

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
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());

    render(<App />);

    expect(await screen.findByText('Session fields: none, 0 sources')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Patch session fields' }));

    expect(await screen.findByText('Session fields: token-1, 1 sources')).toBeInTheDocument();
  });

  test('does not show release announcements or write acknowledgements after login', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());

    render(<App />);

    expect(await screen.findByText('Authenticated app')).toBeInTheDocument();
    expect(screen.queryByText('Update released')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  test('falls back to the authentication screen when loading the session fails', async () => {
    fetchCurrentUser.mockRejectedValue({ response: { status: 401 } });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Sign in')).toBeInTheDocument();
    });

  });

  test('returns to the authentication screen immediately after an auth-expired event', async () => {
    fetchCurrentUser.mockResolvedValue(createTestCurrentUser());

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
      .mockResolvedValueOnce(createTestCurrentUser());

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
      resolveSession(createTestCurrentUser());
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
