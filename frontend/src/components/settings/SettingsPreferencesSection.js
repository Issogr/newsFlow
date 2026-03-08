import React from 'react';

const SettingsPreferencesSection = ({ t, settings, settingsLimits, onDefaultLanguageChange, onNumericSettingChange }) => {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{t('preferences')}</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-slate-700">{t('defaultLanguageSetting')}</span>
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
          <span className="mb-2 block text-sm font-medium text-slate-700">{t('articleRetention')}</span>
          <input
            type="number"
            min={settingsLimits.articleRetentionHours.min}
            max={settingsLimits.articleRetentionHours.max}
            value={settings.articleRetentionHours}
            onChange={(event) => onNumericSettingChange('articleRetentionHours', event.target.value, settingsLimits.articleRetentionHours)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
        </label>

        <label className="block md:col-span-2">
          <span className="mb-2 block text-sm font-medium text-slate-700">{t('quickFilterHours')}</span>
          <input
            type="number"
            min={settingsLimits.recentHours.min}
            max={settingsLimits.recentHours.max}
            value={settings.recentHours}
            onChange={(event) => onNumericSettingChange('recentHours', event.target.value, settingsLimits.recentHours)}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
          />
        </label>
      </div>
    </section>
  );
};

export default SettingsPreferencesSection;
