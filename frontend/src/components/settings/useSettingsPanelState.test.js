import { act, renderHook } from '@testing-library/react';
import useSettingsPanelState from './useSettingsPanelState';
import {
  addUserSource,
  deleteUserSource,
  updateUserSource
} from '../../services/api';

jest.mock('../../services/api', () => ({
  addUserSource: jest.fn(),
  deleteUserSource: jest.fn(),
  exportUserSettings: jest.fn(),
  importUserSettings: jest.fn(),
  updateUserSource: jest.fn(),
  updateUserSettings: jest.fn()
}));

const baseCurrentUser = {
  user: { username: 'alice' },
  settings: {
    defaultLanguage: 'en',
    articleRetentionHours: 24,
    recentHours: 3,
    autoRefreshEnabled: true,
    showNewsImages: true,
    readerPanelPosition: 'right',
    readerTextSize: 'medium',
    lastSeenReleaseNotesVersion: '',
    excludedSourceIds: [],
    excludedSubSourceIds: []
  },
  limits: {
    articleRetentionHoursMax: 24,
    recentHoursMax: 3
  },
  customSources: []
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
      settings: expect.objectContaining({ defaultLanguage: 'en', excludedSourceIds: ['source-1'] }),
      customSources: []
    }));
  });
});
