import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import BrandMark from './BrandMark';
import { completePasswordSetup, validatePasswordSetupToken } from '../services/api';

const MIN_PASSWORD_LENGTH = 8;

function getSetupErrorMessage(error, t) {
  const apiMessage = error?.response?.data?.error?.message;

  if (apiMessage === 'Password is required') {
    return t('authErrorPasswordRequired');
  }

  if (apiMessage === `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`) {
    return t('authErrorPasswordMinLength', { count: MIN_PASSWORD_LENGTH });
  }

  if (apiMessage) {
    return apiMessage;
  }

  return t('invalidSetupLink');
}

const PasswordSetupScreen = ({ t, token, onComplete }) => {
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tokenDetails, setTokenDetails] = useState(null);
  const [error, setError] = useState(token ? '' : t('setupLinkMissing'));

  useEffect(() => {
    let ignore = false;

    async function loadTokenDetails() {
      if (!token) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await validatePasswordSetupToken(token);
        if (!ignore) {
          setTokenDetails(response);
        }
      } catch (requestError) {
        if (!ignore) {
          setTokenDetails(null);
          setError(getSetupErrorMessage(requestError, t));
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadTokenDetails();

    return () => {
      ignore = true;
    };
  }, [t, token]);

  const isAdminBootstrap = tokenDetails?.purpose === 'admin-bootstrap';
  const title = isAdminBootstrap ? t('adminSetupTitle') : t('passwordSetupTitle');
  const subtitle = isAdminBootstrap ? t('adminSetupSubtitle') : t('passwordSetupSubtitle');
  const expiresAtLabel = useMemo(() => {
    if (!tokenDetails?.expiresAt) {
      return '';
    }

    return t('expiresAtLabel', {
      time: new Date(tokenDetails.expiresAt).toLocaleString()
    });
  }, [t, tokenDetails?.expiresAt]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!password) {
      setError(t('authErrorPasswordRequired'));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('authErrorPasswordMinLength', { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    setSubmitting(true);

    try {
      const response = await completePasswordSetup({ token, password });
      await onComplete(response);
    } catch (requestError) {
      setError(getSetupErrorMessage(requestError, t));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-10 text-slate-900">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-3">
          <BrandMark className="h-12 w-12" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">News Flow</h1>
            <p className="text-sm text-slate-500">{subtitle}</p>
          </div>
        </div>

        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
          <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isAdminBootstrap ? 'bg-amber-100 text-amber-700' : 'bg-sky-100 text-sky-700'}`}>
            {isAdminBootstrap ? <ShieldCheck className="h-5 w-5" /> : <KeyRound className="h-5 w-5" />}
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            {tokenDetails?.username && <p className="mt-1 text-sm text-slate-600">{t('passwordSetupAccount', { username: tokenDetails.username })}</p>}
            {expiresAtLabel && <p className="mt-1 text-xs text-slate-500">{expiresAtLabel}</p>}
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('validatingSetupLink')}</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{t('password')}</span>
              <input
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError('');
                }}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400"
                required
                minLength={MIN_PASSWORD_LENGTH}
                disabled={!tokenDetails || submitting}
              />
            </label>

            <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('passwordHelp')}</p>

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!tokenDetails || submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KeyRound className="h-4 w-4" />
              {submitting ? t('saving') : t('passwordSetupAction')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default PasswordSetupScreen;
