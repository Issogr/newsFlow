import { renderHook } from '@testing-library/react';
import { io } from 'socket.io-client';
import useTopicRefreshSocket from './useTopicRefreshSocket';

vi.mock('socket.io-client', () => ({
  io: vi.fn()
}));

describe('useTopicRefreshSocket', () => {
  let handlers;
  let socket;

  beforeEach(() => {
    handlers = new Map();
    socket = {
      on: vi.fn((event, handler) => handlers.set(event, handler)),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn()
    };
    io.mockReturnValue(socket);
  });

  test('subscribes filters and routes topic and news updates separately', () => {
    const onTopicRefresh = vi.fn();
    const onNewsUpdate = vi.fn();
    const subscription = {
      search: 'economy',
      sourceIds: ['ansa'],
      topics: ['Economy'],
      recentHours: 3,
      excludedSourceIds: ['bbc'],
      excludedSubSourceIds: ['bbc_world']
    };

    renderHook(() => useTopicRefreshSocket({ onTopicRefresh, onNewsUpdate, subscription }));

    handlers.get('news:update')({ refresh: true, reason: 'news' });
    handlers.get('news:update')({ count: 1, groupIds: ['group-1'], data: [{ id: 'group-1' }] });
    handlers.get('news:update')({ refresh: true, reason: 'topics' });

    expect(socket.emit).toHaveBeenCalledWith('subscribe:filters', subscription);
    expect(onNewsUpdate).toHaveBeenCalledTimes(1);
    expect(onNewsUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupIds: ['group-1'] }));
    expect(onTopicRefresh).toHaveBeenCalledTimes(1);
    expect(onTopicRefresh).toHaveBeenCalledWith({ refresh: true, reason: 'topics' });
  });

  test('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useTopicRefreshSocket({ onTopicRefresh: vi.fn() }));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('news:update', expect.any(Function));
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
