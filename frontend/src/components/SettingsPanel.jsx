import { Settings } from 'lucide-react';
import ProjectGitHubLink from './ProjectGitHubLink';
import SettingsAccessSection from './settings/SettingsAccessSection';
import SettingsCustomSourcesSection from './settings/SettingsCustomSourcesSection';
import SettingsExclusionsSection from './settings/SettingsExclusionsSection';
import SettingsPreferencesSection from './settings/SettingsPreferencesSection';
import useSettingsPanelState from './settings/useSettingsPanelState';
import InlineAlert from './InlineAlert';
import SlideOverPanelFrame, { SlideOverPanelBody, SlideOverPanelFooter, SlideOverPanelHeader } from './SlideOverPanelFrame';
import { getFriendlyApiErrorMessage } from '../utils/apiError';

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
      <SlideOverPanelHeader
        closeLabel={t('cancel')}
        eyebrow={currentUser.user.username}
        icon={Settings}
        onClose={onClose}
        title={t('settings')}
      />

      <SlideOverPanelBody>
        <div>
          <SettingsPreferencesSection
            t={t}
            settings={settings}
            onSettingChange={setSetting}
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
            <InlineAlert className="my-6">
              {getFriendlyApiErrorMessage(error, t)}
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
      </SlideOverPanelBody>

      <SlideOverPanelFooter>
        <div className="flex items-center gap-2">
          <ProjectGitHubLink />
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
      </SlideOverPanelFooter>
    </SlideOverPanelFrame>
  );
};

export default SettingsPanel;
