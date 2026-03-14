import React from 'react';
import { Clock3, Download, Globe2, PanelRightOpen, Radio, TimerReset, Upload } from 'lucide-react';
import SettingsSectionCard from './SettingsSectionCard';

const SettingsPreferencesSection = ({
  t,
  saving,
  importInputRef,
  settings,
  settingsLimits,
  onDefaultLanguageChange,
  onAutoRefreshChange,
  onReaderPanelPositionChange,
  onNumericSettingChange,
  onExport,
  onImportClick,
  onImport
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
          <span className="mt-2 block text-sm text-slate-500">{t('readerPanelPositionHelp')}</span>
        </label>

        <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 md:col-span-2">
          <input
            type="checkbox"
            checked={settings.autoRefreshEnabled !== false}
            onChange={(event) => onAutoRefreshChange(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">{t('autoRefreshSetting')}</span>
            <span className="mt-1 block text-sm text-slate-500">{t('autoRefreshHelp')}</span>
          </span>
        </label>

        <div className="border-t border-slate-200 pt-5 md:col-span-2">
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
