import { Globe2, Image as ImageIcon, MonitorSmartphone, PanelRightOpen, Radio, Type } from 'lucide-react';
import SettingsSectionCard from './SettingsSectionCard';
import { DEFAULT_READER_TEXT_SIZE, READER_TEXT_SIZE_LABELS, READER_TEXT_SIZE_ORDER } from '../../config/readerTextSize';

const fieldClassName = 'w-full rounded-[1.25rem] border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-[border-color,background-color,box-shadow] focus:border-sky-300 focus:bg-white focus:ring-2 focus:ring-sky-100';

const SettingsPreferencesSection = ({
  t,
  saving,
  settings,
  onSettingChange
}) => {
  const showNewsImagesEnabled = settings.showNewsImages !== false;

  return (
    <SettingsSectionCard icon={Radio} title={t('preferences')} iconToneClassName="text-sky-600">
      <div className="grid gap-x-5 gap-y-6 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <Globe2 className="h-4 w-4 text-sky-600" />
            {t('defaultLanguageSetting')}
          </span>
          <select
            value={settings.defaultLanguage}
            onChange={(event) => onSettingChange('defaultLanguage', event.target.value)}
            disabled={saving}
            className={fieldClassName}
          >
            <option value="auto">{t('useBrowserLanguage')}</option>
            <option value="it">{t('languageItalian')}</option>
            <option value="en">{t('languageEnglish')}</option>
          </select>
        </label>

        <label className="block">
          <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
            <MonitorSmartphone className="h-4 w-4 text-violet-600" />
            {t('themeModeSetting')}
          </span>
          <select
            value={settings.themeMode || 'system'}
            onChange={(event) => onSettingChange('themeMode', event.target.value)}
            disabled={saving}
            className={fieldClassName}
          >
            <option value="system">{t('themeModeSystem')}</option>
            <option value="light">{t('themeModeLight')}</option>
            <option value="dark">{t('themeModeDark')}</option>
          </select>
        </label>

        <fieldset disabled={saving} className="grid gap-x-5 gap-y-6 border-t border-slate-200 pt-5 md:col-span-2 md:grid-cols-2">
          <legend className="mb-4 text-sm font-semibold text-slate-900">{t('readingSettings')}</legend>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <PanelRightOpen className="h-4 w-4 text-indigo-600" />
              {t('readerPanelPositionSetting')}
            </span>
            <select
              value={settings.readerPanelPosition || 'right'}
              onChange={(event) => onSettingChange('readerPanelPosition', event.target.value)}
              className={fieldClassName}
            >
              <option value="left">{t('readerPanelPositionLeft')}</option>
              <option value="center">{t('readerPanelPositionCenter')}</option>
              <option value="right">{t('readerPanelPositionRight')}</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
              <Type className="h-4 w-4 text-rose-600" />
              {t('readerTextSizeSetting')}
            </span>
            <select
              value={settings.readerTextSize || DEFAULT_READER_TEXT_SIZE}
              onChange={(event) => onSettingChange('readerTextSize', event.target.value)}
              className={fieldClassName}
            >
              {READER_TEXT_SIZE_ORDER.map((size) => (
                <option key={size} value={size}>{t(READER_TEXT_SIZE_LABELS[size])}</option>
              ))}
            </select>
          </label>

          <div className="flex items-center justify-between gap-4 md:col-span-2">
            <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-700">
              <ImageIcon className="h-4 w-4 shrink-0 text-violet-600" />
              <span>{t('showNewsImagesSetting')}</span>
            </span>
            <button
              type="button"
              onClick={() => onSettingChange('showNewsImages', !showNewsImagesEnabled)}
              role="switch"
              aria-checked={showNewsImagesEnabled}
              aria-label={t('showNewsImagesSetting')}
              className={`inline-flex h-8 w-14 shrink-0 items-center rounded-full border p-1 transition-colors ${
                showNewsImagesEnabled
                  ? 'border-emerald-200 bg-emerald-500/90 hover:bg-emerald-500'
                  : 'border-slate-200 bg-slate-300 hover:bg-slate-400'
              }`}
            >
              <span
                className={`h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                  showNewsImagesEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
                aria-hidden="true"
              />
              <span className="sr-only">
                {showNewsImagesEnabled ? t('liveActive') : t('liveDisabled')}
              </span>
            </button>
          </div>
        </fieldset>
      </div>
    </SettingsSectionCard>
  );
};

export default SettingsPreferencesSection;
