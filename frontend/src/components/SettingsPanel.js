import React, { useEffect } from 'react';
import { Github, Settings, X } from 'lucide-react';
import SettingsCustomSourcesSection from './settings/SettingsCustomSourcesSection';
import SettingsExclusionsSection from './settings/SettingsExclusionsSection';
import SettingsPreferencesSection from './settings/SettingsPreferencesSection';
import useSettingsPanelState from './settings/useSettingsPanelState';
import { PROJECT_GITHUB_URL } from '../config/projectLinks';

const SettingsPanel = ({ t, currentUser, availableSources, currentChangelogVersion, onClose, onOpenReleaseNotes, onUserUpdate }) => {
  const {
    saving,
    error,
    settings,
    customSources,
    sourceForm,
    editingSourceId,
    editingSourceForm,
    importInputRef,
    settingsLimits,
    excludedSourceCatalog,
    excludedSubFeedCatalog,
    setSourceForm,
    setEditingSourceForm,
    setDefaultLanguage,
    setAutoRefreshEnabled,
    setShowNewsImages,
    setReaderPanelPosition,
    updateNumericSetting,
    toggleExcludedSource,
    toggleExcludedSubFeed,
    handleSave,
    handleExport,
    handleImportClick,
    handleImport,
    handleAddSource,
    startEditSource,
    cancelEditSource,
    handleUpdateSource,
    handleDeleteSource
  } = useSettingsPanelState({
    currentUser,
    availableSources,
    onClose,
    onUserUpdate
  });

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/35 backdrop-blur-sm sm:px-4 sm:py-6">
      <div className="ml-auto flex h-full w-full flex-col overflow-hidden bg-slate-50 shadow-2xl sm:max-w-2xl sm:rounded-[2rem] sm:border sm:border-slate-200">
        <div className="border-b border-slate-200 bg-white px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                <Settings className="h-4 w-4" />
                {t('settings')}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">{currentUser.user.username}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={t('cancel')}>
              <X className="h-5 w-5" />
            </button>
          </div>

        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          <div className="space-y-5">
            <SettingsPreferencesSection
              t={t}
              saving={saving}
              importInputRef={importInputRef}
              settings={settings}
              settingsLimits={settingsLimits}
              onDefaultLanguageChange={setDefaultLanguage}
              onAutoRefreshChange={setAutoRefreshEnabled}
              onShowNewsImagesChange={setShowNewsImages}
              onReaderPanelPositionChange={setReaderPanelPosition}
              onNumericSettingChange={updateNumericSetting}
              onExport={handleExport}
              onImportClick={handleImportClick}
              onImport={handleImport}
            />

            <SettingsExclusionsSection
              t={t}
              settings={settings}
              excludedSourceCatalog={excludedSourceCatalog}
              excludedSubFeedCatalog={excludedSubFeedCatalog}
              onToggleSource={toggleExcludedSource}
              onToggleSubFeed={toggleExcludedSubFeed}
            />

            <SettingsCustomSourcesSection
              t={t}
              saving={saving}
              customSources={customSources}
              sourceForm={sourceForm}
              editingSourceId={editingSourceId}
              editingSourceForm={editingSourceForm}
              onSourceFormChange={setSourceForm}
              onEditingSourceFormChange={setEditingSourceForm}
              onAddSource={handleAddSource}
              onStartEditSource={startEditSource}
              onCancelEditSource={cancelEditSource}
              onUpdateSource={handleUpdateSource}
              onDeleteSource={handleDeleteSource}
            />

            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error.message}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-5 sm:px-6">
          <div className="flex items-center gap-2">
            <a
              href={PROJECT_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
              className="inline-flex items-center justify-center rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Github className="h-5 w-5" />
            </a>
            <button
              type="button"
              onClick={onOpenReleaseNotes}
              className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
            >
              {t('changelogVersionLabel', { version: currentChangelogVersion })}
            </button>
          </div>
          <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
            {saving ? t('saving') : t('saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
