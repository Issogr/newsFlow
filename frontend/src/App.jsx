import { useCallback, useEffect, useMemo, useState } from 'react';
import NewsAggregator from './components/NewsAggregator';
import AdminDashboard from './components/AdminDashboard';
import ApiDocsPage from './components/ApiDocsPage';
import AuthScreen from './components/AuthScreen';
import LegalPolicyPage from './components/LegalPolicyPage';
import PasswordSetupScreen from './components/PasswordSetupScreen';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import ReleaseUpdateNotice from './components/ReleaseUpdateNotice';
import { CURRENT_CHANGELOG_ENTRY, getCurrentChangelog } from './config/changelog';
import { createTranslator, resolvePreferredLocale } from './i18n';
import {
  AUTH_EXPIRED_EVENT,
  fetchCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  updateUserSettings
} from './services/api';

function resolveAppliedTheme(themeMode, mediaQuery) {
  if (themeMode === 'dark') {
    return 'dark';
  }

  if (themeMode === 'light') {
    return 'light';
  }

  return mediaQuery?.matches ? 'dark' : 'light';
}

const PASSWORD_SETUP_PATHS = new Set(['/password/setup', '/admin/setup']);
const API_DOCS_PATHS = new Set(['/api/docs', '/api/docs/']);
const LEGAL_POLICY_BY_PATH = {
  '/privacy-policy': 'privacy',
  '/cookie-policy': 'cookie'
};

function shouldLoadSessionForPath(pathname) {
  return !PASSWORD_SETUP_PATHS.has(pathname)
    && !API_DOCS_PATHS.has(pathname)
    && !LEGAL_POLICY_BY_PATH[pathname];
}

function App() {
  const [locationState, setLocationState] = useState(() => ({
    pathname: window.location.pathname,
    search: window.location.search
  }));
  const [authData, setAuthData] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [loadingSession, setLoadingSession] = useState(() => shouldLoadSessionForPath(window.location.pathname));
  const [releaseNotesState, setReleaseNotesState] = useState({
    hiddenVersion: '',
    noticeHiddenVersion: '',
    saving: false,
    modalOpen: false
  });

  const locale = resolvePreferredLocale(authData?.settings?.defaultLanguage);
  const themeMode = authData?.settings?.themeMode || 'system';
  const t = useMemo(() => createTranslator(locale), [locale]);
  const releaseNotes = useMemo(() => getCurrentChangelog(locale), [locale]);
  const setupToken = (() => {
    const searchToken = new URLSearchParams(locationState.search).get('token') || '';
    if (searchToken) {
      return searchToken;
    }

    const hash = String(window.location.hash || '').replace(/^#/, '');
    return new URLSearchParams(hash).get('token') || '';
  })();
  const isPasswordSetupRoute = PASSWORD_SETUP_PATHS.has(locationState.pathname);
  const isApiDocsRoute = API_DOCS_PATHS.has(locationState.pathname);
  const legalPolicy = LEGAL_POLICY_BY_PATH[locationState.pathname] || '';
  const needsReleaseNotesAck = authData?.settings?.lastSeenReleaseNotesVersion !== releaseNotes.version;
  const shouldShowReleaseNotesModal = Boolean(
    authData
    && !authData?.user?.isAdmin
    && releaseNotes.version
    && releaseNotesState.modalOpen
  );
  const shouldShowReleaseNotice = Boolean(
    authData
    && !authData?.user?.isAdmin
    && releaseNotes.version
    && needsReleaseNotesAck
    && releaseNotesState.hiddenVersion !== releaseNotes.version
    && releaseNotesState.noticeHiddenVersion !== releaseNotes.version
    && !releaseNotesState.modalOpen
  );

  const loadSession = useCallback(async () => {
    if (!shouldLoadSessionForPath(locationState.pathname)) {
      setLoadingSession(false);
      return;
    }

    try {
      const me = await fetchCurrentUser();
      setAuthData(me);
    } catch {
      setAuthData(null);
      setAuthError(null);
    } finally {
      setLoadingSession(false);
    }
  }, [locationState.pathname]);

  useEffect(() => {
    const syncLocationState = () => {
      setLocationState({ pathname: window.location.pathname, search: window.location.search });
    };

    window.addEventListener('popstate', syncLocationState);
    return () => window.removeEventListener('popstate', syncLocationState);
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    const handleAuthExpired = () => {
      setAuthData(null);
      setAuthError(null);
      setLoadingSession(false);
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  useEffect(() => {
    const mediaQuery = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

    const applyTheme = () => {
      const nextTheme = resolveAppliedTheme(themeMode, mediaQuery);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
    };

    applyTheme();

    if (themeMode !== 'system' || !mediaQuery) {
      return undefined;
    }

    const handleChange = () => applyTheme();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }

    return undefined;
  }, [themeMode]);

  useEffect(() => {
    setReleaseNotesState({ hiddenVersion: '', noticeHiddenVersion: '', saving: false, modalOpen: false });
  }, [authData?.user?.id]);

  const handleAuthSuccess = useCallback((payload) => {
    setAuthData({
      user: payload.user,
      settings: payload.settings,
      limits: payload.limits,
      features: payload.features || {},
      sourceCatalog: payload.sourceCatalog || [],
      customSources: payload.customSources,
      apiToken: payload.apiToken || null
    });
    setAuthError(null);
  }, []);

  const handlePasswordSetupComplete = useCallback(async (payload) => {
    window.history.replaceState({}, '', '/');
    setLocationState({ pathname: window.location.pathname, search: window.location.search });
    handleAuthSuccess(payload);
  }, [handleAuthSuccess]);

  const runAuthAction = useCallback(async (authAction, credentials) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      handleAuthSuccess(await authAction(credentials));
    } catch (error) {
      setAuthError(error);
    } finally {
      setAuthBusy(false);
    }
  }, [handleAuthSuccess]);

  const handleLogin = useCallback((credentials) => runAuthAction(loginUser, credentials), [runAuthAction]);

  const handleRegister = useCallback((credentials) => runAuthAction(registerUser, credentials), [runAuthAction]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutUser();
    } catch {
      // ignore logout errors during local cleanup
    }

    setAuthData(null);
    setAuthError(null);
  }, []);

  const handleUserSettingsUpdate = useCallback((settings) => {
    setAuthData((current) => (current ? {
      ...current,
      settings
    } : current));
  }, []);

  const acknowledgeCurrentReleaseNotes = useCallback(async () => {
    const version = CURRENT_CHANGELOG_ENTRY.version;

    setReleaseNotesState((current) => ({
      ...current,
      hiddenVersion: version,
      noticeHiddenVersion: version,
      modalOpen: false,
      saving: needsReleaseNotesAck
    }));

    if (!needsReleaseNotesAck) {
      return;
    }

    try {
      const response = await updateUserSettings({ lastSeenReleaseNotesVersion: version });
      setAuthData((current) => (current ? {
        ...current,
        settings: response.settings
      } : current));
    } catch {
      // Keep the notice dismissed for this session; persistence retries on the next login.
    } finally {
      setReleaseNotesState((current) => ({
        ...current,
        saving: false
      }));
    }
  }, [needsReleaseNotesAck]);

  const handleDismissReleaseNotes = acknowledgeCurrentReleaseNotes;
  const handleDismissReleaseNotice = acknowledgeCurrentReleaseNotes;

  const handleOpenReleaseNotes = useCallback(() => {
    setReleaseNotesState((current) => ({
      ...current,
      modalOpen: true,
      noticeHiddenVersion: releaseNotes.version
    }));
  }, [releaseNotes.version]);

  if (loadingSession) {
    return <div className="App min-h-screen bg-slate-100" />;
  }

  if (isApiDocsRoute) {
    return <ApiDocsPage locale={locale} />;
  }

  if (legalPolicy) {
    return <LegalPolicyPage policy={legalPolicy} />;
  }

  if (isPasswordSetupRoute) {
    return (
      <div className="App">
        <PasswordSetupScreen
          t={t}
          token={setupToken}
          onComplete={handlePasswordSetupComplete}
        />
      </div>
    );
  }

  if (!authData) {
    return (
      <div className="App">
        <AuthScreen
          t={t}
          busy={authBusy}
          error={authError}
          onLogin={handleLogin}
          onRegister={handleRegister}
        />
      </div>
    );
  }

  return (
    <div className="App">
      {authData?.user?.isAdmin ? (
        <AdminDashboard
          t={t}
          currentUser={authData}
          onLogout={handleLogout}
          onUserUpdate={handleUserSettingsUpdate}
        />
      ) : (
        <NewsAggregator
          currentUser={authData}
          onLogout={handleLogout}
          onUserUpdate={setAuthData}
          currentChangelogVersion={releaseNotes.version}
          onOpenReleaseNotes={handleOpenReleaseNotes}
        />
      )}
      {shouldShowReleaseNotice && (
        <ReleaseUpdateNotice
          t={t}
          releaseNotes={releaseNotes}
          onOpen={handleOpenReleaseNotes}
          onExpire={handleDismissReleaseNotice}
          onDismiss={handleDismissReleaseNotice}
        />
      )}
      {shouldShowReleaseNotesModal && (
        <ReleaseNotesModal
          t={t}
          releaseNotes={releaseNotes}
          saving={releaseNotesState.saving}
          onDismiss={handleDismissReleaseNotes}
        />
      )}
    </div>
  );
}

export default App;
