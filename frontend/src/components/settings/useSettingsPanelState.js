import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addUserSource,
  createApiToken,
  deleteUserSource,
  exportUserSettings,
  importUserSettings,
  revokeApiToken,
  updateUserSource,
  updateUserSettings
} from '../../services/api';
import { getSettingsLimits } from '../../config/settingsLimits';
import { getStoredReaderTextSizePreference, setStoredReaderTextSizePreference } from '../../utils/readerTextSizePreference';

const createInitialSourceForm = () => ({ url: '' });
const createInitialEditingSourceForm = () => ({ name: '', url: '', language: 'it' });
const getCurrentUserIdentity = (currentUser) => currentUser?.user?.id || currentUser?.user?.username || currentUser?.id || '';
const getInitialSettings = (currentUser) => ({
  ...currentUser.settings,
  readerTextSize: getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize)
});

const areSettingValuesEqual = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
  }

  return left === right;
};

const createSettingsPatch = (nextSettings, currentUser, dirtyKeys = null) => {
  const initialSettings = getInitialSettings(currentUser);
  const candidateKeys = Array.isArray(dirtyKeys) ? dirtyKeys : Object.keys(nextSettings);

  return candidateKeys.reduce((patch, key) => {
    if (!areSettingValuesEqual(nextSettings[key], initialSettings[key])) {
      patch[key] = nextSettings[key];
    }

    return patch;
  }, {});
};

const useSettingsPanelState = ({ currentUser, availableSources, onClose, onUserUpdate }) => {
  const [settings, setSettings] = useState(() => getInitialSettings(currentUser));
  const [customSources, setCustomSources] = useState(currentUser.customSources || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [sourceError, setSourceError] = useState(null);
  const [apiToken, setApiToken] = useState(currentUser.apiToken || null);
  const [newApiToken, setNewApiToken] = useState('');
  const [sourceForm, setSourceForm] = useState(createInitialSourceForm);
  const [editingSourceId, setEditingSourceId] = useState('');
  const [editingSourceForm, setEditingSourceForm] = useState(createInitialEditingSourceForm);
  const importInputRef = useRef(null);
  const userIdentityRef = useRef(getCurrentUserIdentity(currentUser));
  const dirtySettingKeysRef = useRef(new Set());
  const settingsLimits = useMemo(() => getSettingsLimits(currentUser), [currentUser]);

  const excludedSourceCatalog = useMemo(() => {
    const customSourceIds = new Set(customSources.map((source) => source.id));
    return availableSources.filter((source) => !customSourceIds.has(source.id));
  }, [availableSources, customSources]);

  const excludedSubFeedCatalog = useMemo(() => {
    return excludedSourceCatalog
      .filter((source) => Array.isArray(source.subSources) && source.subSources.length > 1)
      .map((source) => ({
        id: source.id,
        name: source.name,
        subSources: source.subSources
      }));
  }, [excludedSourceCatalog]);

  const subSourceIdsBySourceId = useMemo(() => {
    return new Map(excludedSubFeedCatalog.map((source) => [
      source.id,
      new Set(source.subSources.map((subSource) => subSource.id))
    ]));
  }, [excludedSubFeedCatalog]);

  useEffect(() => {
    const nextUserIdentity = getCurrentUserIdentity(currentUser);
    if (userIdentityRef.current !== nextUserIdentity) {
      userIdentityRef.current = nextUserIdentity;
      dirtySettingKeysRef.current.clear();
      setSettings(getInitialSettings(currentUser));
      setNewApiToken('');
      setSourceError(null);
      setSourceForm(createInitialSourceForm());
      setEditingSourceId('');
      setEditingSourceForm(createInitialEditingSourceForm());
    } else {
      setSettings((current) => {
        const latestPersistedSettings = getInitialSettings(currentUser);
        const dirtyKeys = dirtySettingKeysRef.current;
        let changed = false;
        const nextSettings = { ...current };

        Object.entries(latestPersistedSettings).forEach(([key, value]) => {
          if (!dirtyKeys.has(key) && !areSettingValuesEqual(current[key], value)) {
            nextSettings[key] = value;
            changed = true;
          }
        });

        return changed ? nextSettings : current;
      });
    }

    setCustomSources(currentUser.customSources || []);
    setApiToken(currentUser.apiToken || null);
  }, [currentUser]);

  const syncPersistedUserState = useCallback((nextSettings, nextCustomSources) => {
    dirtySettingKeysRef.current.clear();
    setSettings(nextSettings);
    setCustomSources(nextCustomSources);
    onUserUpdate({
      ...currentUser,
      settings: nextSettings,
      customSources: nextCustomSources
    });
  }, [currentUser, onUserUpdate]);

  const syncCustomSourcesState = useCallback((nextCustomSources, nextSettings = null) => {
    setCustomSources(nextCustomSources);
    onUserUpdate({
      ...currentUser,
      ...(nextSettings ? { settings: nextSettings } : {}),
      customSources: nextCustomSources
    });
  }, [currentUser, onUserUpdate]);

  const runSavingAction = useCallback(async (action, options = {}) => {
    setSaving(true);
    setError(null);

    try {
      return await action();
    } catch (requestError) {
      if (options.globalError !== false) {
        setError(requestError);
      }
      options.onError?.(requestError);
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const setSetting = useCallback((key, value) => {
    dirtySettingKeysRef.current.add(key);
    setSettings((current) => ({
      ...current,
      [key]: value
    }));
  }, []);

  const toggleExcludedSource = useCallback((sourceId) => {
    dirtySettingKeysRef.current.add('excludedSourceIds');
    dirtySettingKeysRef.current.add('excludedSubSourceIds');
    setSettings((current) => {
      const excludedSourceIds = current.excludedSourceIds || [];
      const excludedSubSourceIds = current.excludedSubSourceIds || [];
      const exists = excludedSourceIds.includes(sourceId);

      return {
        ...current,
        excludedSourceIds: exists
          ? excludedSourceIds.filter((item) => item !== sourceId)
          : [...excludedSourceIds, sourceId],
        excludedSubSourceIds: exists
          ? excludedSubSourceIds
          : excludedSubSourceIds.filter((item) => !subSourceIdsBySourceId.get(sourceId)?.has(item))
      };
    });
  }, [subSourceIdsBySourceId]);

  const toggleExcludedSubFeed = useCallback((subSourceId) => {
    dirtySettingKeysRef.current.add('excludedSubSourceIds');
    setSettings((current) => {
      const excludedSubSourceIds = current.excludedSubSourceIds || [];
      const exists = excludedSubSourceIds.includes(subSourceId);

      return {
        ...current,
        excludedSubSourceIds: exists
          ? excludedSubSourceIds.filter((item) => item !== subSourceId)
          : [...excludedSubSourceIds, subSourceId]
      };
    });
  }, []);

  const handleSave = useCallback(async () => {
    await runSavingAction(async () => {
      const dirtySettingKeys = [...dirtySettingKeysRef.current];
      const settingsPatch = createSettingsPatch(settings, currentUser, dirtySettingKeys);
      if (Object.keys(settingsPatch).length === 0) {
        dirtySettingKeysRef.current.clear();
        onClose();
        return;
      }

      const response = await updateUserSettings(settingsPatch);
      setStoredReaderTextSizePreference(response.settings.readerTextSize);
      syncPersistedUserState(response.settings, customSources);
      onClose();
    });
  }, [currentUser, customSources, onClose, runSavingAction, settings, syncPersistedUserState]);

  const handleCreateApiToken = useCallback(async () => {
    await runSavingAction(async () => {
      const response = await createApiToken();
      setApiToken(response.tokenInfo || null);
      setNewApiToken(response.token || '');
      onUserUpdate({
        ...currentUser,
        apiToken: response.tokenInfo || null
      });
    });
  }, [currentUser, onUserUpdate, runSavingAction]);

  const handleRevokeApiToken = useCallback(async () => {
    await runSavingAction(async () => {
      await revokeApiToken();
      setApiToken(null);
      setNewApiToken('');
      onUserUpdate({
        ...currentUser,
        apiToken: null
      });
    });
  }, [currentUser, onUserUpdate, runSavingAction]);

  const handleExport = useCallback(async () => {
    await runSavingAction(async () => {
      const payload = await exportUserSettings();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      try {
        link.href = url;
        link.download = `news-flow-settings-${currentUser.user.username}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } finally {
        window.URL.revokeObjectURL(url);
      }
    });
  }, [currentUser.user.username, runSavingAction]);

  const handleImportClick = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImport = useCallback(async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);

      await runSavingAction(async () => {
        const response = await importUserSettings(payload);
        setStoredReaderTextSizePreference(response.settings.readerTextSize);
        syncPersistedUserState(response.settings, response.customSources);
      });
    } catch (requestError) {
      setError(requestError instanceof SyntaxError ? new Error('Invalid settings file format') : requestError);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  }, [runSavingAction, syncPersistedUserState]);

  const handleAddSource = useCallback(async (event) => {
    event.preventDefault();
    setSourceError(null);

    await runSavingAction(async () => {
      const response = await addUserSource(sourceForm);
      const nextCustomSources = [response.source, ...customSources];
      setSourceForm(createInitialSourceForm());
      syncCustomSourcesState(nextCustomSources);
    }, { globalError: false, onError: setSourceError });
  }, [customSources, runSavingAction, sourceForm, syncCustomSourcesState]);

  const startEditSource = useCallback((source) => {
    setEditingSourceId(source.id);
    setEditingSourceForm({
      name: source.name,
      url: source.url,
      language: source.language || 'it'
    });
  }, []);

  const cancelEditSource = useCallback(() => {
    setEditingSourceId('');
    setEditingSourceForm(createInitialEditingSourceForm());
  }, []);

  const handleUpdateSource = useCallback(async (sourceId) => {
    setSourceError(null);

    await runSavingAction(async () => {
      const response = await updateUserSource(sourceId, editingSourceForm);
      const nextCustomSources = customSources.map((source) => (
        source.id === sourceId ? response.source : source
      ));
      syncCustomSourcesState(nextCustomSources);
      cancelEditSource();
    }, { globalError: false, onError: setSourceError });
  }, [cancelEditSource, customSources, editingSourceForm, runSavingAction, syncCustomSourcesState]);

  const handleDeleteSource = useCallback(async (sourceId) => {
    await runSavingAction(async () => {
      await deleteUserSource(sourceId);
      const nextCustomSources = customSources.filter((source) => source.id !== sourceId);
      const nextSettings = {
        ...settings,
        excludedSourceIds: (settings.excludedSourceIds || []).filter((item) => item !== sourceId)
      };
      const nextPersistedSettings = {
        ...(currentUser?.settings || {}),
        excludedSourceIds: (currentUser?.settings?.excludedSourceIds || []).filter((item) => item !== sourceId)
      };
      setSettings(nextSettings);
      syncCustomSourcesState(nextCustomSources, nextPersistedSettings);
    });
  }, [currentUser?.settings, customSources, runSavingAction, settings, syncCustomSourcesState]);

  return {
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
  };
};

export default useSettingsPanelState;
