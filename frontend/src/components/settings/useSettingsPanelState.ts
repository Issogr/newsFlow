import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
import {
  getStoredReaderTextSizePreference,
  getStoredReaderTextWidthPreference,
  setStoredReaderTextSizePreference,
  setStoredReaderTextWidthPreference
} from '../../utils/readerPreferences';
import type { ApiTokenInfo, CurrentUser, NewsSource, UserSettings } from '../../types';

const createInitialEditingSourceForm = () => ({ name: '', url: '', language: 'it' });
const getCurrentUserIdentity = (currentUser: CurrentUser) => currentUser?.user?.id || currentUser?.user?.username || currentUser?.id || '';
const getInitialSettings = (currentUser: CurrentUser): UserSettings => ({
  ...currentUser.settings,
  readerTextSize: getStoredReaderTextSizePreference(currentUser?.settings?.readerTextSize),
  readerTextWidth: getStoredReaderTextWidthPreference(currentUser?.settings?.readerTextWidth)
});

const areSettingValuesEqual = (left: unknown, right: unknown) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left || []) === JSON.stringify(right || []);
  }

  return left === right;
};

const createSettingsPatch = (nextSettings: UserSettings, currentUser: CurrentUser, dirtyKeys: string[]): Partial<UserSettings> => {
  const persistedSettings = getInitialSettings(currentUser);

  return dirtyKeys.reduce<Partial<UserSettings>>((patch, key) => {
    if (!areSettingValuesEqual(nextSettings[key], persistedSettings[key])) {
      patch[key] = nextSettings[key];
    }

    return patch;
  }, {});
};

const useSettingsPanelState = ({ currentUser, availableSources, patchSession }: {
  currentUser: CurrentUser;
  availableSources: NewsSource[];
  patchSession: (patch: Partial<CurrentUser>) => void;
}) => {
  const [settings, setSettings] = useState(() => getInitialSettings(currentUser));
  const [customSources, setCustomSources] = useState(currentUser.customSources || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sourceError, setSourceError] = useState<unknown>(null);
  const [apiToken, setApiToken] = useState<ApiTokenInfo | null>(currentUser.apiToken || null);
  const [newApiToken, setNewApiToken] = useState('');
  const [editingSourceId, setEditingSourceId] = useState('');
  const [editingSourceForm, setEditingSourceForm] = useState(createInitialEditingSourceForm);
  const [pendingDeletedSourceIds, setPendingDeletedSourceIds] = useState<string[]>([]);
  const importInputRef = useRef<HTMLInputElement>(null);
  const userIdentityRef = useRef(getCurrentUserIdentity(currentUser));
  const currentUserRef = useRef(currentUser);
  const dirtySettingKeysRef = useRef(new Set<string>());
  const savingActionsRef = useRef(0);
  currentUserRef.current = currentUser;
  const settingsLimits = {
    apiTokenTtlDays: Number.isFinite(currentUser?.limits?.apiTokenTtlDays) ? currentUser.limits?.apiTokenTtlDays ?? 30 : 30,
    customSourcesMaxCount: Number.isFinite(currentUser?.limits?.customSourcesMaxCount) ? currentUser.limits?.customSourcesMaxCount ?? 8 : 8
  };

  const excludedSourceCatalog = useMemo(() => {
    const customSourceIds = new Set(customSources.map((source) => source.id));
    return availableSources.filter((source) => !customSourceIds.has(source.id));
  }, [availableSources, customSources]);

  const subSourceIdsBySourceId = useMemo(() => {
    return new Map<string, Set<string>>(excludedSourceCatalog
      .filter((source) => Array.isArray(source.subSources) && source.subSources.length > 1)
      .map((source) => [source.id, new Set((source.subSources || []).map((subSource) => subSource.id))]));
  }, [excludedSourceCatalog]);

  useEffect(() => {
    const nextUserIdentity = getCurrentUserIdentity(currentUser);
    if (userIdentityRef.current !== nextUserIdentity) {
      userIdentityRef.current = nextUserIdentity;
      dirtySettingKeysRef.current.clear();
      setSettings(getInitialSettings(currentUser));
      setNewApiToken('');
      setSourceError(null);
      setEditingSourceId('');
      setEditingSourceForm(createInitialEditingSourceForm());
      setPendingDeletedSourceIds([]);
    } else {
      setSettings((current) => {
        const persistedSettings = getInitialSettings(currentUser);
        const nextSettings = { ...current };
        let changed = false;

        Object.entries(persistedSettings).forEach(([key, value]) => {
          if (dirtySettingKeysRef.current.has(key) && areSettingValuesEqual(current[key], value)) {
            dirtySettingKeysRef.current.delete(key);
          } else if (!dirtySettingKeysRef.current.has(key) && !areSettingValuesEqual(current[key], value)) {
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

  const syncPersistedUserState = useCallback((nextSettings: UserSettings, nextCustomSources: NewsSource[]) => {
    dirtySettingKeysRef.current.clear();
    setSettings(nextSettings);
    setCustomSources(nextCustomSources);
    patchSession({
      settings: nextSettings,
      customSources: nextCustomSources
    });
  }, [patchSession]);

  const syncCustomSourcesState = useCallback((nextCustomSources: NewsSource[], nextSettings: UserSettings | null = null) => {
    setCustomSources(nextCustomSources);
    patchSession({
      ...(nextSettings ? { settings: nextSettings } : {}),
      customSources: nextCustomSources
    });
  }, [patchSession]);

  const runSavingAction = useCallback(async <T,>(action: () => Promise<T>, options: { globalError?: boolean; onError?: (error: unknown) => void } = {}): Promise<T | null> => {
    savingActionsRef.current += 1;
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
      savingActionsRef.current -= 1;
      if (savingActionsRef.current === 0) {
        setSaving(false);
      }
    }
  }, []);

  const markSettingDirty = useCallback((key: string, value: unknown) => {
    const persistedValue = getInitialSettings(currentUserRef.current)[key];
    if (areSettingValuesEqual(value, persistedValue)) {
      dirtySettingKeysRef.current.delete(key);
    } else {
      dirtySettingKeysRef.current.add(key);
    }
  }, []);

  const setSetting = useCallback((key: string, value: unknown) => {
    markSettingDirty(key, value);
    setSettings((current) => ({ ...current, [key]: value }));
  }, [markSettingDirty]);

  const toggleExcludedSource = useCallback((sourceId: string) => {
    const excludedSourceIds = settings.excludedSourceIds || [];
    const excludedSubSourceIds = settings.excludedSubSourceIds || [];
    const subSourceIds = subSourceIdsBySourceId.get(sourceId);
    const isHidden = excludedSourceIds.includes(sourceId)
      || (subSourceIds && [...subSourceIds].every((id) => excludedSubSourceIds.includes(id)));
    const nextExcludedSourceIds = isHidden
      ? excludedSourceIds.filter((item) => item !== sourceId)
      : [...excludedSourceIds, sourceId];
    const nextExcludedSubSourceIds = excludedSubSourceIds.filter((item) => !subSourceIds?.has(item));

    markSettingDirty('excludedSourceIds', nextExcludedSourceIds);
    markSettingDirty('excludedSubSourceIds', nextExcludedSubSourceIds);
    setSettings({
      ...settings,
      excludedSourceIds: nextExcludedSourceIds,
      excludedSubSourceIds: nextExcludedSubSourceIds
    });
  }, [markSettingDirty, settings, subSourceIdsBySourceId]);

  const toggleExcludedSubFeed = useCallback((subSourceId: string) => {
    const parentSource = [...subSourceIdsBySourceId].find(([, subSourceIds]) => subSourceIds.has(subSourceId));
    const excludedSubSourceIds = settings.excludedSubSourceIds || [];
    const exists = excludedSubSourceIds.includes(subSourceId);
    let nextExcludedSubSourceIds = exists
      ? excludedSubSourceIds.filter((item) => item !== subSourceId)
      : [...excludedSubSourceIds, subSourceId];
    let nextExcludedSourceIds = settings.excludedSourceIds || [];

    if (parentSource?.[1] && [...parentSource[1]].every((id) => nextExcludedSubSourceIds.includes(id))) {
      nextExcludedSourceIds = [...new Set([...nextExcludedSourceIds, parentSource[0]])];
      nextExcludedSubSourceIds = nextExcludedSubSourceIds.filter((item) => !parentSource[1].has(item));
    }

    markSettingDirty('excludedSourceIds', nextExcludedSourceIds);
    markSettingDirty('excludedSubSourceIds', nextExcludedSubSourceIds);
    setSettings({
      ...settings,
      excludedSourceIds: nextExcludedSourceIds,
      excludedSubSourceIds: nextExcludedSubSourceIds
    });
  }, [markSettingDirty, settings, subSourceIdsBySourceId]);

  const editingSource = customSources.find((source) => source.id === editingSourceId);
  const hasEditingSourceChanges = Boolean(editingSource) && (
    editingSourceForm.name !== editingSource?.name
    || editingSourceForm.url !== editingSource?.url
    || editingSourceForm.language !== (editingSource?.language || 'it')
  );

  const persistSourceUpdate = useCallback(async (sourceId: string, existingSources: NewsSource[] = customSources) => {
    const response = await updateUserSource(sourceId, editingSourceForm);
    return existingSources.map((source) => (
      source.id === sourceId ? response.source : source
    ));
  }, [customSources, editingSourceForm]);

  const handleSave = useCallback(async () => {
    const dirtySettingKeys = [...dirtySettingKeysRef.current];
    const settingsPatch = createSettingsPatch(settings, currentUserRef.current, dirtySettingKeys);
    if (Object.keys(settingsPatch).length === 0 && !hasEditingSourceChanges && pendingDeletedSourceIds.length === 0) {
      dirtySettingKeysRef.current.clear();
      return true;
    }

    setSourceError(null);
    const result = await runSavingAction(async () => {
      let nextCustomSources = customSources;
      let nextSettings = getInitialSettings(currentUserRef.current);

      if (hasEditingSourceChanges) {
        nextCustomSources = await persistSourceUpdate(editingSourceId, nextCustomSources);
      }

      for (const sourceId of pendingDeletedSourceIds) {
        await deleteUserSource(sourceId);
      }
      nextCustomSources = nextCustomSources.filter((source) => !pendingDeletedSourceIds.includes(source.id));

      if (Object.keys(settingsPatch).length > 0) {
        const response = await updateUserSettings(settingsPatch);
        const persistedPatch = Object.keys(settingsPatch).reduce<Partial<UserSettings>>((patch, key) => ({
          ...patch,
          [key]: response.settings[key]
        }), {});
        nextSettings = { ...getInitialSettings(currentUserRef.current), ...persistedPatch };
      }

      return { nextCustomSources, nextSettings };
    });
    if (!result) {
      return false;
    }

    const nextSettings = Object.keys(settingsPatch).length > 0
      ? result.nextSettings
      : getInitialSettings(currentUserRef.current);
    setStoredReaderTextSizePreference(nextSettings.readerTextSize);
    setStoredReaderTextWidthPreference(nextSettings.readerTextWidth);
    setEditingSourceId('');
    setEditingSourceForm(createInitialEditingSourceForm());
    setPendingDeletedSourceIds([]);
    syncPersistedUserState(nextSettings, result.nextCustomSources);
    return true;
  }, [customSources, editingSourceId, hasEditingSourceChanges, pendingDeletedSourceIds, persistSourceUpdate, runSavingAction, settings, syncPersistedUserState]);

  const handleCreateApiToken = useCallback(async () => {
    await runSavingAction(async () => {
      const response = await createApiToken();
      setApiToken(response.tokenInfo || null);
      setNewApiToken(response.token || '');
      patchSession({ apiToken: response.tokenInfo || null });
    });
  }, [patchSession, runSavingAction]);

  const handleRevokeApiToken = useCallback(async () => {
    await runSavingAction(async () => {
      await revokeApiToken();
      setApiToken(null);
      setNewApiToken('');
      patchSession({ apiToken: null });
    });
  }, [patchSession, runSavingAction]);

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

  const handleImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
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
        setStoredReaderTextWidthPreference(response.settings.readerTextWidth);
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

  const handleAddDiscoveredSources = useCallback(async (urls: string[]) => {
    const existingUrls = new Set(customSources.map((source) => source.url));
    const pendingUrls = [...new Set(urls.map((url) => url.trim()).filter((url) => url && !existingUrls.has(url)))];
    const addedUrls: string[] = [];
    if (pendingUrls.length === 0) {
      return addedUrls;
    }

    setSourceError(null);
    await runSavingAction(async () => {
      let nextCustomSources = customSources;
      for (const url of pendingUrls) {
        const response = await addUserSource({ url });
        nextCustomSources = [response.source, ...nextCustomSources];
        addedUrls.push(url);
        syncCustomSourcesState(nextCustomSources);
      }
    }, { globalError: false, onError: setSourceError });

    return addedUrls;
  }, [customSources, runSavingAction, syncCustomSourcesState]);

  const startEditSource = useCallback((source: NewsSource) => {
    setEditingSourceId(source.id);
    setEditingSourceForm({
      name: source.name,
      url: source.url || '',
      language: source.language || 'it'
    });
  }, []);

  const cancelEditSource = useCallback(() => {
    setEditingSourceId('');
    setEditingSourceForm(createInitialEditingSourceForm());
  }, []);

  const handleDeleteSource = useCallback((sourceId: string) => {
    const nextExcludedSourceIds = (settings.excludedSourceIds || []).filter((item) => item !== sourceId);
    const nextExcludedSubSourceIds = (settings.excludedSubSourceIds || []).filter((item) => item !== sourceId);
    markSettingDirty('excludedSourceIds', nextExcludedSourceIds);
    markSettingDirty('excludedSubSourceIds', nextExcludedSubSourceIds);
    setSettings((current) => ({
      ...current,
      excludedSourceIds: nextExcludedSourceIds,
      excludedSubSourceIds: nextExcludedSubSourceIds
    }));
    setPendingDeletedSourceIds((current) => current.includes(sourceId) ? current : [...current, sourceId]);
    if (editingSourceId === sourceId) {
      cancelEditSource();
    }
  }, [cancelEditSource, editingSourceId, markSettingDirty, settings.excludedSourceIds, settings.excludedSubSourceIds]);

  const hasUnsavedChanges = Object.keys(createSettingsPatch(
    settings,
    currentUser,
    [...dirtySettingKeysRef.current]
  )).length > 0 || hasEditingSourceChanges || pendingDeletedSourceIds.length > 0;

  return {
    saving,
    hasUnsavedChanges,
    error,
    sourceError,
    settings,
    apiToken,
    newApiToken,
    customSources,
    pendingDeletedSourceIds,
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
    handleDeleteSource
  };
};

export default useSettingsPanelState;
