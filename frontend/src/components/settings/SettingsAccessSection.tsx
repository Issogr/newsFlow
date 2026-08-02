import { ChevronDown, Download, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import ExternalPillLink from '../ExternalPillLink';
import SettingsSectionCard from './SettingsSectionCard';
import type { ButtonHTMLAttributes, ChangeEvent, ReactNode, RefObject } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { ApiTokenInfo, Translator } from '../../types';

const SettingsActionButton = ({ icon: Icon, iconClassName, children, ...buttonProps }: {
  icon: LucideIcon;
  iconClassName: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    className="flex items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
    {...buttonProps}
  >
    <span className="inline-flex h-8 w-8 items-center justify-center text-slate-700">
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
}: {
  t: Translator;
  saving: boolean;
  importInputRef: RefObject<HTMLInputElement | null>;
  showApiTokenControls?: boolean;
  apiToken: ApiTokenInfo | null;
  newApiToken: string;
  settingsLimits: { apiTokenTtlDays?: number; customSourcesMaxCount?: number };
  onExport: () => void;
  onImportClick: () => void;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateApiToken: () => void;
  onRevokeApiToken: () => void;
}) => {
  const apiTokenStatusItems = apiToken ? [
    {
      key: 'prefix',
      label: t('apiTokenStatusLabel'),
      value: apiToken.tokenPrefix,
      labelClassName: 'text-emerald-700',
      valueClassName: 'break-all text-emerald-900'
    },
    {
      key: 'expires',
      label: t('apiTokenExpiresLabel'),
      value: apiToken.expiresAt ? new Date(apiToken.expiresAt).toLocaleString() : ''
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
      iconToneClassName="text-emerald-600"
    >
      <div className="flex flex-wrap gap-2">
        <ExternalPillLink href="/privacy-policy" target="_blank">{t('privacyPolicyLink')}</ExternalPillLink>
        <ExternalPillLink href="/cookie-policy" target="_blank">{t('cookiePolicyLink')}</ExternalPillLink>
      </div>

      <details className="group rounded-[1.25rem] border border-slate-200 bg-slate-50">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
          <span>{t('advancedSettings')}</span>
          <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>

        <div className="space-y-6 border-t border-slate-200 bg-white px-4 py-5">
          {showApiTokenControls ? (
            <div className="space-y-5">
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
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                    {t('apiTokenExpiryHelp', { days: settingsLimits.apiTokenTtlDays || 30 })}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onCreateApiToken}
                  disabled={saving}
                  className="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
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
                <div className="grid gap-x-5 gap-y-4 border-y border-slate-200 py-4 md:grid-cols-2 xl:grid-cols-3">
                  {apiTokenStatusItems.map((item) => (
                    <div key={item.key} className="min-w-0">
                      <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${item.labelClassName || 'text-slate-500'}`}>{item.label}</p>
                      <p className={`mt-1 text-sm font-medium ${item.valueClassName || 'break-words text-slate-800'}`}>{item.value}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm font-medium text-slate-500">{t('apiTokenInactive')}</p>
              )}

              {newApiToken ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-sm font-medium text-emerald-900">{t('apiTokenGenerated')}</p>
                  <p className="mt-1 break-all font-mono text-sm text-emerald-800">{newApiToken}</p>
                  <p className="mt-2 text-xs text-emerald-700">{t('apiTokenGeneratedHelp')}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={`grid gap-3 md:grid-cols-2 ${showApiTokenControls ? 'border-t border-slate-200 pt-6' : ''}`}>
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
        </div>
      </details>

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
