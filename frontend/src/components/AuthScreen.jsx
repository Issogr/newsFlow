import { useState } from 'react';
import { ExternalLink, LogIn, UserPlus } from 'lucide-react';
import AuthCard, {
  AUTH_INPUT_CLASS_NAME,
  AUTH_PRIMARY_BUTTON_CLASS_NAME,
  MIN_PASSWORD_LENGTH,
  getPasswordApiErrorMessage,
  getPasswordValidationError,
} from './AuthCard';
import InlineAlert from './InlineAlert';

const AuthScreen = ({ t, onLogin, onRegister, busy, error }) => {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clientError, setClientError] = useState('');

  const getFriendlyError = () => {
    if (clientError) {
      return clientError;
    }

    if (!error) {
      return '';
    }

    const apiCode = error.response?.data?.error?.code;
    const apiMessage = error.response?.data?.error?.message;
    const status = error.response?.status;

    if (error.code === 'ECONNABORTED') {
      return t('authErrorTimeout');
    }

    if (!error.response) {
      return t('authErrorNetwork');
    }

    if (apiCode === 'USER_ALREADY_EXISTS' || status === 409 || apiMessage === 'Username already exists') {
      return t('authErrorUsernameTaken');
    }

    const passwordErrorMessage = getPasswordApiErrorMessage(apiMessage, t);
    if (passwordErrorMessage) {
      return passwordErrorMessage;
    }

    if (apiCode === 'INVALID_PASSWORD') {
      return apiMessage || t('authErrorPasswordRequired');
    }

    if (apiCode === 'INVALID_USERNAME' || apiMessage === 'Username must contain at least 3 characters') {
      return t('authErrorInvalidUsername');
    }

    if (apiCode === 'UNAUTHORIZED' || status === 401 || apiMessage === 'Invalid username or password') {
      return t('authErrorInvalidCredentials');
    }

    if (status === 429) {
      return t('authErrorRateLimit');
    }

    if (status === 503) {
      return t('authErrorUnavailable');
    }

    if (status === 500) {
      return t('authErrorServer');
    }

    return apiMessage || t('authErrorGeneric');
  };

  const rawErrorMessage = clientError ? '' : (error?.message || '');
  const friendlyError = getFriendlyError();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setClientError('');

    if (mode === 'login') {
      await onLogin({ username, password });
      return;
    }

    const passwordErrorMessage = getPasswordValidationError(password, t);
    if (passwordErrorMessage) {
      setClientError(passwordErrorMessage);
      return;
    }

    await onRegister({ username, password });
  };

  return (
    <AuthCard subtitle={t('authSubtitle')}>
      <div className="mb-6 grid grid-cols-2 rounded-2xl bg-slate-100 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setClientError('');
          }}
          className={`rounded-2xl px-4 py-2.5 transition-colors ${mode === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
        >
          {t('signIn')}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setClientError('');
          }}
          className={`rounded-2xl px-4 py-2.5 transition-colors ${mode === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
        >
          {t('createAccount')}
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{t('username')}</span>
          <input
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setClientError('');
            }}
            className={AUTH_INPUT_CLASS_NAME}
            required
            minLength={3}
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{t('password')}</span>
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setClientError('');
            }}
            className={AUTH_INPUT_CLASS_NAME}
            required={mode === 'register'}
            minLength={mode === 'register' ? MIN_PASSWORD_LENGTH : undefined}
          />
        </label>

        {mode === 'register' && (
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('passwordHelp')}</p>
        )}

        {(clientError || error) && (
          <InlineAlert>
            <p className="font-medium">{friendlyError}</p>
            {rawErrorMessage && rawErrorMessage !== friendlyError && (
              <p className="mt-1 text-xs text-red-600">{rawErrorMessage}</p>
            )}
          </InlineAlert>
        )}

        <button
          type="submit"
          disabled={busy}
          className={AUTH_PRIMARY_BUTTON_CLASS_NAME}
        >
          {mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {mode === 'login' ? t('loginAction') : t('registerAction')}
        </button>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-500">
          <p>{t('technicalCookieNotice')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href="/privacy-policy"
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              <span>{t('privacyPolicyLink')}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
            <a
              href="/cookie-policy"
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
            >
              <span>{t('cookiePolicyLink')}</span>
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </form>
    </AuthCard>
  );
};

export default AuthScreen;
