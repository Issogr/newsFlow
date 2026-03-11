import React from 'react';
import { Settings, X } from 'lucide-react';
import SettingsCustomSourcesSection from './settings/SettingsCustomSourcesSection';
import SettingsExclusionsSection from './settings/SettingsExclusionsSection';
import SettingsPreferencesSection from './settings/SettingsPreferencesSection';
import SettingsTransferSection from './settings/SettingsTransferSection';
import useSettingsPanelState from './settings/useSettingsPanelState';

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

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              <Settings className="h-4 w-4" />
              {t('settings')}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-slate-900">{currentUser.user.username}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-6 py-6">
          <SettingsTransferSection
            t={t}
            saving={saving}
            importInputRef={importInputRef}
            onExport={handleExport}
            onImportClick={handleImportClick}
            onImport={handleImport}
          />

          <SettingsPreferencesSection
            t={t}
            settings={settings}
            settingsLimits={settingsLimits}
            onDefaultLanguageChange={setDefaultLanguage}
            onAutoRefreshChange={setAutoRefreshEnabled}
            onReaderPanelPositionChange={setReaderPanelPosition}
            onNumericSettingChange={updateNumericSetting}
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

        <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-6 py-5">
          <button
            type="button"
            onClick={onOpenReleaseNotes}
            className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-900"
          >
            {t('changelogVersionLabel', { version: currentChangelogVersion })}
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
            {saving ? t('saving') : t('saveSettings')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
