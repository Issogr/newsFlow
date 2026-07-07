import { Download, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import ExternalPillLink from '../ExternalPillLink';
import SettingsSectionCard from './SettingsSectionCard';

const SettingsActionButton = ({ icon: Icon, iconClassName, children, ...buttonProps }) => (
  <button
    type="button"
    className="flex items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
    {...buttonProps}
  >
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
      <Icon className={`h-4 w-4 ${iconClassName}`} />
    </span>
    <span>{children}</span>
  </button>
);

const SettingsAccessSection = ({
  t,
  saving,
  importInputRef,
  showApiTokenControls = false,
  apiToken,
  newApiToken,
  settingsLimits,
  onExport,
  onImportClick,
  onImport,
  onCreateApiToken,
  onRevokeApiToken
}) => {
  const apiTokenStatusCards = apiToken ? [
    {
      key: 'prefix',
      label: t('apiTokenStatusLabel'),
      value: apiToken.tokenPrefix,
      cardClassName: 'border-emerald-200 bg-emerald-50',
      labelClassName: 'text-emerald-700',
      valueClassName: 'break-all text-emerald-900'
    },
    {
      key: 'expires',
      label: t('apiTokenExpiresLabel'),
      value: new Date(apiToken.expiresAt).toLocaleString()
    },
    {
      key: 'lastUsed',
      label: t('apiTokenLastUsedLabel'),
      value: apiToken.lastUsedAt ? new Date(apiToken.lastUsedAt).toLocaleString() : t('apiTokenLastUsedEmpty')
    }
  ] : [];

  return (
    <SettingsSectionCard
      icon={ShieldCheck}
      title={t('settingsAccessSectionTitle')}
      description={t('settingsAccessSectionDescription')}
      iconToneClassName="bg-emerald-100 text-emerald-700"
    >
      {showApiTokenControls ? (
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
          <div className="space-y-4">
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                <KeyRound className="h-4 w-4 text-amber-600" />
                {t('apiTokenTitle')}
              </p>
              <p className="max-w-2xl text-sm text-slate-600">{t('apiTokenHelp')}</p>
              <div className="flex flex-wrap gap-2">
                <ExternalPillLink href="/api/docs" target="_blank" className="border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100">
                  {t('apiTokenDocsLink')}
                </ExternalPillLink>
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
                  {t('apiTokenExpiryHelp', { days: settingsLimits.apiTokenTtlDays || 30 })}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onCreateApiToken}
                disabled={saving}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
              >
                {apiToken ? t('apiTokenRegenerate') : t('apiTokenGenerate')}
              </button>
              {apiToken ? (
                <button
                  type="button"
                  onClick={onRevokeApiToken}
                  disabled={saving}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
                >
                  {t('apiTokenRevoke')}
                </button>
              ) : null}
            </div>

            {apiToken ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {apiTokenStatusCards.map((card) => (
                  <div key={card.key} className={`min-w-0 rounded-2xl border px-3 py-3 ${card.cardClassName || 'border-slate-200 bg-white'}`}>
                    <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${card.labelClassName || 'text-slate-500'}`}>{card.label}</p>
                    <p className={`mt-1 text-sm font-medium ${card.valueClassName || 'break-words text-slate-800'}`}>{card.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inline-flex w-fit items-center rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
                {t('apiTokenInactive')}
              </div>
            )}
          </div>

          {newApiToken ? (
            <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-medium text-emerald-900">{t('apiTokenGenerated')}</p>
              <p className="mt-1 break-all font-mono text-sm text-emerald-800">{newApiToken}</p>
              <p className="mt-2 text-xs text-emerald-700">{t('apiTokenGeneratedHelp')}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 md:col-span-2">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              {t('legalDocsTitle')}
            </p>
            <p className="max-w-2xl text-sm text-slate-600">{t('legalDocsHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <ExternalPillLink href="/privacy-policy" target="_blank">{t('privacyPolicyLink')}</ExternalPillLink>
              <ExternalPillLink href="/cookie-policy" target="_blank">{t('cookiePolicyLink')}</ExternalPillLink>
            </div>
          </div>
        </div>

        <SettingsActionButton
          onClick={onExport}
          disabled={saving}
          icon={Download}
          iconClassName="text-sky-700"
        >
          {t('exportSettings')}
        </SettingsActionButton>

        <SettingsActionButton
          onClick={onImportClick}
          disabled={saving}
          icon={Upload}
          iconClassName="text-emerald-700"
        >
          {t('importSettings')}
        </SettingsActionButton>
      </div>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={onImport}
      />
    </SettingsSectionCard>
  );
};

export default SettingsAccessSection;
