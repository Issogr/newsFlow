import BrandMark from './BrandMark';

export const MIN_PASSWORD_LENGTH = 8;
const AUTH_INPUT_CLASS_NAME = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition-colors focus:border-slate-400';
export const AUTH_PRIMARY_BUTTON_CLASS_NAME = 'inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60';

export function getPasswordValidationError(password, t) {
  if (!password) {
    return t('authErrorPasswordRequired');
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return t('authErrorPasswordMinLength', { count: MIN_PASSWORD_LENGTH });
  }

  return '';
}

export function getPasswordApiErrorMessage(apiMessage, t) {
  if (apiMessage === 'Password is required') {
    return t('authErrorPasswordRequired');
  }

  if (apiMessage === `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`) {
    return t('authErrorPasswordMinLength', { count: MIN_PASSWORD_LENGTH });
  }

  return '';
}

export const AuthTextInput = ({ label, ...inputProps }) => (
  <label className="block">
    <span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>
    <input
      {...inputProps}
      className={AUTH_INPUT_CLASS_NAME}
    />
  </label>
);

const AuthCard = ({ children, subtitle }) => {
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

        {children}
      </div>
    </div>
  );
};

export default AuthCard;
