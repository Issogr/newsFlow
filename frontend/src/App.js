import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './App.css';
import NewsAggregator from './components/NewsAggregator';
import AuthScreen from './components/AuthScreen';
import { createTranslator, detectBrowserLocale } from './i18n';
import {
  fetchCurrentUser,
  getAuthToken,
  loginUser,
  logoutUser,
  registerUser,
  setAuthToken
} from './services/api';

function App() {
  const [authData, setAuthData] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [loadingSession, setLoadingSession] = useState(Boolean(getAuthToken()));

  const locale = useMemo(() => {
    const preferred = authData?.settings?.defaultLanguage;
    if (preferred === 'it' || preferred === 'en') {
      return preferred;
    }
    return detectBrowserLocale();
  }, [authData?.settings?.defaultLanguage]);
  const t = useMemo(() => createTranslator(locale), [locale]);

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

  const handleAuthSuccess = useCallback((payload) => {
    setAuthToken(payload.token);
    setAuthData({
      user: payload.user,
      settings: payload.settings,
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
      />
    </div>
  );
}

export default App;
