import { Settings, X } from 'lucide-react';
import GitHubIcon from './icons/GitHubIcon';
import SettingsAccessSection from './settings/SettingsAccessSection';
import SettingsCustomSourcesSection from './settings/SettingsCustomSourcesSection';
import SettingsExclusionsSection from './settings/SettingsExclusionsSection';
import SettingsPreferencesSection from './settings/SettingsPreferencesSection';
import useSettingsPanelState from './settings/useSettingsPanelState';
import InlineAlert from './InlineAlert';
import SlideOverPanelFrame from './SlideOverPanelFrame';
import { PROJECT_GITHUB_URL } from '../config/projectLinks';

const SettingsPanel = ({ t, currentUser, availableSources, currentChangelogVersion, onClose, onOpenReleaseNotes, onUserUpdate }) => {
  const publicApiAuthenticatedEnabled = currentUser?.features?.publicApi?.authenticatedEnabled === true;
  const {
    saving,
    error,
    sourceError,
    settings,
    apiToken,
    newApiToken,
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
    setSetting,
    updateNumericSetting,
    toggleExcludedSource,
    toggleExcludedSubFeed,
    handleSave,
    handleExport,
    handleImportClick,
    handleImport,
    handleCreateApiToken,
    handleRevokeApiToken,
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
    <SlideOverPanelFrame>
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
              settings={settings}
              settingsLimits={settingsLimits}
              onSettingChange={setSetting}
              onNumericSettingChange={updateNumericSetting}
            />

            <SettingsCustomSourcesSection
              t={t}
              saving={saving}
              sourceError={sourceError}
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

            <SettingsExclusionsSection
              t={t}
              settings={settings}
              excludedSourceCatalog={excludedSourceCatalog}
              excludedSubFeedCatalog={excludedSubFeedCatalog}
              onToggleSource={toggleExcludedSource}
              onToggleSubFeed={toggleExcludedSubFeed}
            />

            {error && (
              <InlineAlert>
                {error.message}
              </InlineAlert>
            )}

            <SettingsAccessSection
              t={t}
              saving={saving}
              importInputRef={importInputRef}
              showApiTokenControls={publicApiAuthenticatedEnabled}
              apiToken={apiToken}
              newApiToken={newApiToken}
              settingsLimits={settingsLimits}
              onExport={handleExport}
              onImportClick={handleImportClick}
              onImport={handleImport}
              onCreateApiToken={handleCreateApiToken}
              onRevokeApiToken={handleRevokeApiToken}
            />
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
              <GitHubIcon className="h-5 w-5" />
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
            {t('save')}
          </button>
        </div>
    </SlideOverPanelFrame>
  );
};

export default SettingsPanel;
