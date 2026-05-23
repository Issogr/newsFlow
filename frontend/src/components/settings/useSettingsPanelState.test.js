import { act, renderHook } from '@testing-library/react';
import useSettingsPanelState from './useSettingsPanelState';
import {
  addUserSource,
  createApiToken,
  deleteUserSource,
  revokeApiToken,
  updateUserSource,
  updateUserSettings
} from '../../services/api';

vi.mock('../../services/api', () => ({
  addUserSource: vi.fn(),
  createApiToken: vi.fn(),
  deleteUserSource: vi.fn(),
  exportUserSettings: vi.fn(),
  importUserSettings: vi.fn(),
  revokeApiToken: vi.fn(),
  updateUserSource: vi.fn(),
  updateUserSettings: vi.fn()
}));

const baseCurrentUser = {
  user: { id: 'user-1', username: 'alice' },
  settings: {
    defaultLanguage: 'en',
    themeMode: 'system',
    articleRetentionHours: 24,
    recentHours: 3,
    showNewsImages: true,
    readerPanelPosition: 'right',
    readerTextSize: 'medium',
    lastSeenReleaseNotesVersion: '',
    excludedSourceIds: [],
    excludedSubSourceIds: []
  },
  limits: {
    articleRetentionHoursMax: 24,
    recentHoursMax: 3,
    apiTokenTtlDays: 30
  },
  customSources: [],
  apiToken: null
};

describe('useSettingsPanelState', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('keeps unsaved settings local when adding a source', async () => {
    const onUserUpdate = jest.fn();
    const source = {
      id: 'source-1',
      name: 'Example Feed',
      url: 'https://example.com/rss',
      language: 'en'
    };

    addUserSource.mockResolvedValue({ source });

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser: baseCurrentUser,
      availableSources: [],
      onClose: jest.fn(),
      onUserUpdate
    }));

    act(() => {
      result.current.setDefaultLanguage('it');
      result.current.setSourceForm({ url: source.url });
    });

    await act(async () => {
      await result.current.handleAddSource({ preventDefault: jest.fn() });
    });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.customSources).toEqual([source]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultLanguage: 'en' }),
      customSources: [source]
    }));
  });

  test('keeps unsaved settings after parent rerenders from a source add', async () => {
    const onUserUpdate = jest.fn();
    const source = {
      id: 'source-1',
      name: 'Example Feed',
      url: 'https://example.com/rss',
      language: 'en'
    };

    addUserSource.mockResolvedValue({ source });

    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: jest.fn(),
      onUserUpdate
    }), { initialProps: { currentUser: baseCurrentUser } });

    act(() => {
      result.current.setDefaultLanguage('it');
      result.current.setSourceForm({ url: source.url });
    });

    await act(async () => {
      await result.current.handleAddSource({ preventDefault: jest.fn() });
    });

    rerender({ currentUser: onUserUpdate.mock.calls.at(-1)[0] });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.customSources).toEqual([source]);
  });

  test('keeps unsaved settings after parent rerenders from token changes', async () => {
    const onUserUpdate = jest.fn();
    createApiToken.mockResolvedValue({
      token: 'raw-token',
      tokenInfo: { tokenPrefix: 'raw-token', expiresAt: '2026-01-01T00:00:00.000Z' }
    });

    const { result, rerender } = renderHook(({ currentUser }) => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: jest.fn(),
      onUserUpdate
    }), { initialProps: { currentUser: baseCurrentUser } });

    act(() => {
      result.current.setDefaultLanguage('it');
    });

    await act(async () => {
      await result.current.handleCreateApiToken();
    });

    rerender({ currentUser: onUserUpdate.mock.calls.at(-1)[0] });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.apiToken).toEqual({ tokenPrefix: 'raw-token', expiresAt: '2026-01-01T00:00:00.000Z' });
    expect(result.current.newApiToken).toBe('raw-token');
  });

  test('surfaces source add failures near the custom source form', async () => {
    const requestError = new Error('The request timed out. Please try again in a few seconds.');
    addUserSource.mockRejectedValue(requestError);

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser: baseCurrentUser,
      availableSources: [],
      onClose: jest.fn(),
      onUserUpdate: jest.fn()
    }));

    act(() => {
      result.current.setSourceForm({ url: 'https://example.com/rss' });
    });

    await act(async () => {
      await result.current.handleAddSource({ preventDefault: jest.fn() });
    });

    expect(result.current.sourceError).toBe(requestError);
    expect(result.current.customSources).toEqual([]);
  });

  test('keeps unsaved settings local when updating a source', async () => {
    const onUserUpdate = jest.fn();
    const currentUser = {
      ...baseCurrentUser,
      customSources: [{
        id: 'source-1',
        name: 'Old Feed',
        url: 'https://example.com/rss',
        language: 'en'
      }]
    };
    const updatedSource = {
      id: 'source-1',
      name: 'Updated Feed',
      url: 'https://example.com/new-rss',
      language: 'it'
    };

    updateUserSource.mockResolvedValue({ source: updatedSource });

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: jest.fn(),
      onUserUpdate
    }));

    act(() => {
      result.current.setDefaultLanguage('it');
      result.current.startEditSource(currentUser.customSources[0]);
      result.current.setEditingSourceForm({
        name: updatedSource.name,
        url: updatedSource.url,
        language: updatedSource.language
      });
    });

    await act(async () => {
      await result.current.handleUpdateSource(updatedSource.id);
    });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.customSources).toEqual([updatedSource]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultLanguage: 'en' }),
      customSources: [updatedSource]
    }));
  });

  test('cleans deleted source from the local draft without leaking other draft settings', async () => {
    const onUserUpdate = jest.fn();
    const currentUser = {
      ...baseCurrentUser,
      settings: {
        ...baseCurrentUser.settings,
        excludedSourceIds: ['source-1']
      },
      customSources: [{
        id: 'source-1',
        name: 'Old Feed',
        url: 'https://example.com/rss',
        language: 'en'
      }]
    };

    deleteUserSource.mockResolvedValue({ success: true });

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser,
      availableSources: [],
      onClose: jest.fn(),
      onUserUpdate
    }));

    act(() => {
      result.current.setDefaultLanguage('it');
    });

    await act(async () => {
      await result.current.handleDeleteSource('source-1');
    });

    expect(result.current.settings.defaultLanguage).toBe('it');
    expect(result.current.settings.excludedSourceIds).toEqual([]);
    expect(result.current.customSources).toEqual([]);
    expect(onUserUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ defaultLanguage: 'en', excludedSourceIds: [] }),
      customSources: []
    }));
  });

  test('saves only changed settings to avoid stale full-snapshot overwrites', async () => {
    const onClose = jest.fn();
    const onUserUpdate = jest.fn();
    updateUserSettings.mockResolvedValue({
      settings: {
        ...baseCurrentUser.settings,
        defaultLanguage: 'it'
      }
    });

    const { result } = renderHook(() => useSettingsPanelState({
      currentUser: baseCurrentUser,
      availableSources: [],
      onClose,
      onUserUpdate
    }));

    act(() => {
      result.current.setDefaultLanguage('it');
    });

    await act(async () => {
      await result.current.handleSave();
    });

    expect(updateUserSettings).toHaveBeenCalledWith({ defaultLanguage: 'it' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
