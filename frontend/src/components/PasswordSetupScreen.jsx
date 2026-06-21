import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { completePasswordSetup, validatePasswordSetupToken } from '../services/api';
import AuthCard, {
  AUTH_INPUT_CLASS_NAME,
  AUTH_PRIMARY_BUTTON_CLASS_NAME,
  MIN_PASSWORD_LENGTH,
  getPasswordApiErrorMessage,
  getPasswordValidationError,
} from './AuthCard';
import InlineAlert from './InlineAlert';

function getSetupErrorMessage(error, t) {
  const apiMessage = error?.response?.data?.error?.message;

  const passwordErrorMessage = getPasswordApiErrorMessage(apiMessage, t);
  if (passwordErrorMessage) {
    return passwordErrorMessage;
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
  const expiresAtLabel = tokenDetails?.expiresAt
    ? t('expiresAtLabel', {
      time: new Date(tokenDetails.expiresAt).toLocaleString()
    })
    : '';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    const passwordErrorMessage = getPasswordValidationError(password, t);
    if (passwordErrorMessage) {
      setError(passwordErrorMessage);
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
    <AuthCard subtitle={subtitle}>
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
              className={AUTH_INPUT_CLASS_NAME}
              required
              minLength={MIN_PASSWORD_LENGTH}
              disabled={!tokenDetails || submitting}
            />
          </label>

          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-500">{t('passwordHelp')}</p>

          {error && (
            <InlineAlert>
              {error}
            </InlineAlert>
          )}

          <button
            type="submit"
            disabled={!tokenDetails || submitting}
            className={AUTH_PRIMARY_BUTTON_CLASS_NAME}
          >
            <KeyRound className="h-4 w-4" />
            {submitting ? t('saving') : t('passwordSetupAction')}
          </button>
        </form>
      )}
    </AuthCard>
  );
};

export default PasswordSetupScreen;
