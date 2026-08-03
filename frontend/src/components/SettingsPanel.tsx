import { useEffect, useState, type RefObject } from 'react';
import { Settings } from 'lucide-react';
import ProjectGitHubLink from './ProjectGitHubLink';
import SettingsAccessSection from './settings/SettingsAccessSection';
import SettingsCustomSourcesSection from './settings/SettingsCustomSourcesSection';
import SettingsExclusionsSection from './settings/SettingsExclusionsSection';
import SettingsPreferencesSection from './settings/SettingsPreferencesSection';
import useSettingsPanelState from './settings/useSettingsPanelState';
import InlineAlert from './InlineAlert';
import ModalDialog from './ModalDialog';
import SlideOverPanelFrame, { SlideOverPanelBody, SlideOverPanelFooter, SlideOverPanelHeader } from './SlideOverPanelFrame';
import { getFriendlyApiErrorMessage } from '../utils/apiError';
import type { CurrentUser, NewsSource, Translator } from '../types';

const UnsavedSettingsDialog = ({ t, saving, onCancel, onDiscard, onSave }: { t: Translator; saving: boolean; onCancel: () => void; onDiscard: () => void; onSave: () => void }) => (
  <ModalDialog
    ariaDescribedBy="unsaved-settings-message"
    ariaLabelledBy="unsaved-settings-title"
    className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm"
    dismissOnEscape={!saving}
    onRequestClose={onCancel}
    role="alertdialog"
  >
    <div className="w-full max-w-md rounded-[1.6rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-28px_rgba(15,23,42,0.5)]" data-modal-content>
      <h2 id="unsaved-settings-title" className="text-xl font-semibold text-slate-900 focus:outline-none" data-modal-title tabIndex={-1}>
        {t('unsavedSettingsTitle')}
      </h2>
      <p id="unsaved-settings-message" className="mt-3 text-sm leading-6 text-slate-600">{t('unsavedSettingsMessage')}</p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button type="button" onClick={onCancel} disabled={saving} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {t('continueEditing')}
        </button>
        <button type="button" onClick={onDiscard} disabled={saving} className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60">
          {t('discardChanges')}
        </button>
        <button type="button" onClick={onSave} disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
          {saving ? t('saving') : t('saveChanges')}
        </button>
      </div>
    </div>
  </ModalDialog>
);

const SettingsPanel = ({ t, currentUser, availableSources, currentChangelogVersion, onClose, onOpenReleaseNotes, patchSession, restoreFocusRef }: {
  t: Translator;
  currentUser: CurrentUser;
  availableSources: NewsSource[];
  currentChangelogVersion: string;
  onClose: () => void;
  onOpenReleaseNotes: () => void;
  patchSession: (patch: Partial<CurrentUser>) => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) => {
  const [confirmingClose, setConfirmingClose] = useState(false);
  const publicApiAuthenticatedEnabled = currentUser?.features?.publicApi?.authenticatedEnabled === true;
  const {
    saving,
    hasUnsavedChanges,
    error,
    sourceError,
    settings,
    apiToken,
    newApiToken,
    customSources,
    editingSourceId,
    editingSourceForm,
    importInputRef,
    settingsLimits,
    excludedSourceCatalog,
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
    handleAddDiscoveredSources,
    startEditSource,
    cancelEditSource,
    handleUpdateSource,
    handleDeleteSource
  } = useSettingsPanelState({
    currentUser,
    availableSources,
    patchSession
  });

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return undefined;
    }

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleRequestClose = () => {
    if (saving) {
      return;
    }

    if (hasUnsavedChanges) {
      setConfirmingClose(true);
    } else {
      onClose();
    }
  };

  const handleSaveAndClose = async () => {
    const saved = await handleSave();
    setConfirmingClose(false);
    if (saved) {
      onClose();
    }
  };

  return (
    <SlideOverPanelFrame ariaLabelledBy="settings-panel-title" dismissOnEscape={!saving} onClose={handleRequestClose} restoreFocusRef={restoreFocusRef}>
      <SlideOverPanelHeader
        closeDisabled={saving}
        closeLabel={t('close')}
        eyebrow={currentUser.user.username}
        icon={Settings}
        onClose={handleRequestClose}
        title={t('settings')}
        titleId="settings-panel-title"
      />

      <SlideOverPanelBody>
        <div>
          {Boolean(error) && (
            <InlineAlert className="mb-6">
              {getFriendlyApiErrorMessage(error, t)}
            </InlineAlert>
          )}

          <SettingsPreferencesSection
            t={t}
            saving={saving}
            settings={settings}
            onSettingChange={setSetting}
          />

          <SettingsExclusionsSection
            t={t}
            saving={saving}
            settings={settings}
            excludedSourceCatalog={excludedSourceCatalog}
            onToggleSource={toggleExcludedSource}
            onToggleSubFeed={toggleExcludedSubFeed}
          />

          <SettingsCustomSourcesSection
            t={t}
            saving={saving}
            sourceError={sourceError}
            customSources={customSources}
            maxSourceCount={settingsLimits.customSourcesMaxCount}
            editingSourceId={editingSourceId}
            editingSourceForm={editingSourceForm}
            onEditingSourceFormChange={setEditingSourceForm}
            onAddDiscoveredSources={handleAddDiscoveredSources}
            onStartEditSource={startEditSource}
            onCancelEditSource={cancelEditSource}
            onUpdateSource={handleUpdateSource}
            onDeleteSource={handleDeleteSource}
          />

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
            disabled={saving}
            className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 disabled:opacity-50"
          >
            {t('changelogVersionLabel', { version: currentChangelogVersion })}
          </button>
        </div>
        <button type="button" onClick={handleSaveAndClose} disabled={saving || !hasUnsavedChanges} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60">
          {saving ? t('saving') : t('save')}
        </button>
      </SlideOverPanelFooter>

      {confirmingClose ? (
        <UnsavedSettingsDialog
          t={t}
          saving={saving}
          onCancel={() => setConfirmingClose(false)}
          onDiscard={onClose}
          onSave={handleSaveAndClose}
        />
      ) : null}
    </SlideOverPanelFrame>
  );
};

export default SettingsPanel;
