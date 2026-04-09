import React from 'react';
import { Clock3, Download, ExternalLink, Globe2, Image as ImageIcon, KeyRound, MonitorSmartphone, PanelRightOpen, Radio, RefreshCw, TimerReset, Type, Upload } from 'lucide-react';
import SettingsSectionCard from './SettingsSectionCard';
import { DEFAULT_READER_TEXT_SIZE, READER_TEXT_SIZE_LABELS, READER_TEXT_SIZE_ORDER } from '../../config/readerTextSize';

const SettingsPreferencesSection = ({
  t,
  saving,
  importInputRef,
  settings,
  apiToken,
  newApiToken,
  settingsLimits,
  onDefaultLanguageChange,
  onThemeModeChange,
  onAutoRefreshChange,
  onShowNewsImagesChange,
  onReaderPanelPositionChange,
  onReaderTextSizeChange,
  onNumericSettingChange,
  onExport,
  onImportClick,
  onImport,
  onCreateApiToken,
  onRevokeApiToken
}) => {
  const articleRetentionRange = `${settingsLimits.articleRetentionHours.min}-${settingsLimits.articleRetentionHours.max}h`;
  const recentHoursRange = `${settingsLimits.recentHours.min}-${settingsLimits.recentHours.max}h`;

  return (
    <SettingsSectionCard icon={Radio} title={t('preferences')} iconToneClassName="bg-sky-100 text-sky-700">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Globe2 className="h-4 w-4 text-sky-600" />
            {t('defaultLanguageSetting')}
          </span>
          <select
            value={settings.defaultLanguage}
            onChange={(event) => onDefaultLanguageChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <option value="auto">{t('useBrowserLanguage')}</option>
            <option value="it">IT</option>
            <option value="en">EN</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <TimerReset className="h-4 w-4 text-amber-600" />
            {t('articleRetention')}
          </span>
          <input
            type="number"
            min={settingsLimits.articleRetentionHours.min}
            max={settingsLimits.articleRetentionHours.max}
            value={settings.articleRetentionHours}
            onChange={(event) => onNumericSettingChange('articleRetentionHours', event.target.value, settingsLimits.articleRetentionHours)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <span className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {articleRetentionRange}
          </span>
        </label>

        <label className="block">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <MonitorSmartphone className="h-4 w-4 text-violet-600" />
            {t('themeModeSetting')}
          </span>
          <select
            value={settings.themeMode || 'system'}
            onChange={(event) => onThemeModeChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <option value="system">{t('themeModeSystem')}</option>
            <option value="light">{t('themeModeLight')}</option>
            <option value="dark">{t('themeModeDark')}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Clock3 className="h-4 w-4 text-teal-600" />
            {t('quickFilterHours')}
          </span>
          <input
            type="number"
            min={settingsLimits.recentHours.min}
            max={settingsLimits.recentHours.max}
            value={settings.recentHours}
            onChange={(event) => onNumericSettingChange('recentHours', event.target.value, settingsLimits.recentHours)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
          <span className="mt-2 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">
            {recentHoursRange}
          </span>
        </label>

        <label className="block">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <PanelRightOpen className="h-4 w-4 text-indigo-600" />
            {t('readerPanelPositionSetting')}
          </span>
          <select
            value={settings.readerPanelPosition || 'right'}
            onChange={(event) => onReaderPanelPositionChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            <option value="left">{t('readerPanelPositionLeft')}</option>
            <option value="center">{t('readerPanelPositionCenter')}</option>
            <option value="right">{t('readerPanelPositionRight')}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Type className="h-4 w-4 text-rose-600" />
            {t('readerTextSizeSetting')}
          </span>
          <select
            value={settings.readerTextSize || DEFAULT_READER_TEXT_SIZE}
            onChange={(event) => onReaderTextSizeChange(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          >
            {READER_TEXT_SIZE_ORDER.map((size) => (
              <option key={size} value={size}>{t(READER_TEXT_SIZE_LABELS[size])}</option>
            ))}
          </select>
        </label>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
            <RefreshCw className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{t('autoRefreshSetting')}</span>
          </span>
          <button
            type="button"
            onClick={() => onAutoRefreshChange(settings.autoRefreshEnabled === false)}
            aria-pressed={settings.autoRefreshEnabled !== false}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
              settings.autoRefreshEnabled !== false
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                settings.autoRefreshEnabled !== false ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              aria-hidden="true"
            />
            <span>{settings.autoRefreshEnabled !== false ? t('liveActive') : t('liveDisabled')}</span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
            <ImageIcon className="h-4 w-4 shrink-0 text-violet-600" />
            <span>{t('showNewsImagesSetting')}</span>
          </span>
          <button
            type="button"
            onClick={() => onShowNewsImagesChange(settings.showNewsImages === false)}
            aria-pressed={settings.showNewsImages !== false}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition-colors ${
              settings.showNewsImages !== false
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                settings.showNewsImages !== false ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              aria-hidden="true"
            />
            <span>{settings.showNewsImages !== false ? t('liveActive') : t('liveDisabled')}</span>
          </button>
        </div>

        <div className="border-t border-slate-200 pt-5 md:col-span-2">
          <div className="mb-5 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
            <div className="space-y-4">
              <div className="space-y-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  {t('apiTokenTitle')}
                </p>
                <p className="max-w-2xl text-sm text-slate-600">{t('apiTokenHelp')}</p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="/api"
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
                    <p className="mt-1 text-sm font-medium text-emerald-900 break-all">{apiToken.tokenPrefix}</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('apiTokenExpiresLabel')}</p>
                    <p className="mt-1 text-sm font-medium text-slate-800 break-words">{new Date(apiToken.expiresAt).toLocaleString()}</p>
                  </div>
                  <div className="min-w-0 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{t('apiTokenLastUsedLabel')}</p>
                    <p className="mt-1 text-sm font-medium text-slate-800 break-words">{apiToken.lastUsedAt ? new Date(apiToken.lastUsedAt).toLocaleString() : t('apiTokenLastUsedEmpty')}</p>
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
        </div>
      </div>
    </SettingsSectionCard>
  );
};

export default SettingsPreferencesSection;
