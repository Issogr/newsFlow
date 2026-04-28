import React from 'react';
import { Download, ExternalLink, KeyRound, ShieldCheck, Upload } from 'lucide-react';
import SettingsSectionCard from './SettingsSectionCard';

const SettingsAccessSection = ({
  t,
  saving,
  importInputRef,
  apiToken,
  newApiToken,
  settingsLimits,
  onExport,
  onImportClick,
  onImport,
  onCreateApiToken,
  onRevokeApiToken
}) => {
  return (
    <SettingsSectionCard
      icon={ShieldCheck}
      title={t('settingsAccessSectionTitle')}
      description={t('settingsAccessSectionDescription')}
      iconToneClassName="bg-emerald-100 text-emerald-700"
    >
      <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <KeyRound className="h-4 w-4 text-amber-600" />
              {t('apiTokenTitle')}
            </p>
            <p className="max-w-2xl text-sm text-slate-600">{t('apiTokenHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/api/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-100"
              >
                <span>{t('apiTokenDocsLink')}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
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
              <div className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">{t('apiTokenStatusLabel')}</p>
                <p className="mt-1 break-all text-sm font-medium text-emerald-900">{apiToken.tokenPrefix}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('apiTokenExpiresLabel')}</p>
                <p className="mt-1 break-words text-sm font-medium text-slate-800">{new Date(apiToken.expiresAt).toLocaleString()}</p>
              </div>
              <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('apiTokenLastUsedLabel')}</p>
                <p className="mt-1 break-words text-sm font-medium text-slate-800">{apiToken.lastUsedAt ? new Date(apiToken.lastUsedAt).toLocaleString() : t('apiTokenLastUsedEmpty')}</p>
              </div>
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

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4 md:col-span-2">
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              {t('legalDocsTitle')}
            </p>
            <p className="max-w-2xl text-sm text-slate-600">{t('legalDocsHelp')}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <span>{t('privacyPolicyLink')}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
              <a
                href="/cookie-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
              >
                <span>{t('cookiePolicyLink')}</span>
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onExport}
          disabled={saving}
          className="flex items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
            <Download className="h-4 w-4 text-sky-700" />
          </span>
          <span>{t('exportSettings')}</span>
        </button>

        <button
          type="button"
          onClick={onImportClick}
          disabled={saving}
          className="flex items-center gap-3 rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
            <Upload className="h-4 w-4 text-emerald-700" />
          </span>
          <span>{t('importSettings')}</span>
        </button>
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
