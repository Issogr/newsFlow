import React, { useCallback, useEffect, useMemo, useState } from 'react';
import NewsAggregator from './components/NewsAggregator';
import AuthScreen from './components/AuthScreen';
import ReleaseNotesModal from './components/ReleaseNotesModal';
import { CURRENT_CHANGELOG_ENTRY, getCurrentChangelog } from './config/changelog';
import { createTranslator, resolvePreferredLocale } from './i18n';
import {
  fetchCurrentUser,
  getAuthToken,
  loginUser,
  logoutUser,
  registerUser,
  setAuthToken,
  updateUserSettings
} from './services/api';

function App() {
  const [authData, setAuthData] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [loadingSession, setLoadingSession] = useState(Boolean(getAuthToken()));
  const [releaseNotesState, setReleaseNotesState] = useState({
    hiddenVersion: '',
    saving: false,
    manuallyOpened: false
  });

  const locale = useMemo(() => {
    return resolvePreferredLocale(authData?.settings?.defaultLanguage);
  }, [authData?.settings?.defaultLanguage]);
  const t = useMemo(() => createTranslator(locale), [locale]);
  const releaseNotes = useMemo(() => getCurrentChangelog(locale), [locale]);
  const needsReleaseNotesAck = authData?.settings?.lastSeenReleaseNotesVersion !== releaseNotes.version;
  const shouldShowReleaseNotes = Boolean(
    authData
    && releaseNotes.version
    && (
      releaseNotesState.manuallyOpened
      || (needsReleaseNotesAck && releaseNotesState.hiddenVersion !== releaseNotes.version)
    )
  );

  const loadSession = useCallback(async () => {
    if (!getAuthToken()) {
      setLoadingSession(false);
      return;
    }

    try {
      const me = await fetchCurrentUser();
      setAuthData(me);
    } catch (error) {
      setAuthData(null);
      setAuthError(null);
      setAuthToken('');
    } finally {
      setLoadingSession(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    setReleaseNotesState({ hiddenVersion: '', saving: false, manuallyOpened: false });
  }, [authData?.user?.id]);

  const handleAuthSuccess = useCallback((payload) => {
    setAuthToken(payload.token);
    setAuthData({
      user: payload.user,
      settings: payload.settings,
      limits: payload.limits,
      customSources: payload.customSources
    });
    setAuthError(null);
  }, []);

  const handleLogin = useCallback(async (credentials) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      handleAuthSuccess(await loginUser(credentials));
    } catch (error) {
      setAuthError(error);
    } finally {
      setAuthBusy(false);
    }
  }, [handleAuthSuccess]);

  const handleRegister = useCallback(async (credentials) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      handleAuthSuccess(await registerUser(credentials));
    } catch (error) {
      setAuthError(error);
    } finally {
      setAuthBusy(false);
    }
  }, [handleAuthSuccess]);

  const handleLogout = useCallback(async () => {
    try {
      await logoutUser();
    } catch {
      // ignore logout errors during local cleanup
    }

    setAuthToken('');
    setAuthData(null);
    setAuthError(null);
  }, []);

  const handleDismissReleaseNotes = useCallback(async () => {
    const version = CURRENT_CHANGELOG_ENTRY.version;

    setReleaseNotesState((current) => ({
      ...current,
      hiddenVersion: version,
      manuallyOpened: false,
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
      // keep the popup dismissed for the current session; it will retry next login if persistence fails
    } finally {
      setReleaseNotesState((current) => ({
        ...current,
        saving: false
      }));
    }
  }, [needsReleaseNotesAck]);

  const handleOpenReleaseNotes = useCallback(() => {
    setReleaseNotesState((current) => ({
      ...current,
      manuallyOpened: true,
      hiddenVersion: ''
    }));
  }, []);

  if (loadingSession) {
    return <div className="App min-h-screen bg-slate-100" />;
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
      <NewsAggregator
        currentUser={authData}
        onLogout={handleLogout}
        onUserUpdate={setAuthData}
        currentChangelogVersion={releaseNotes.version}
        onOpenReleaseNotes={handleOpenReleaseNotes}
      />
      {shouldShowReleaseNotes && (
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
