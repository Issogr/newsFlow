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
    vi.clearAllMocks();
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
    const onSummariesRefresh = vi.fn();
    const onNewsUpdate = vi.fn();
    const subscription = {
      search: 'economy',
      sourceIds: ['ansa'],
      topics: ['Economy'],
      excludedSourceIds: ['bbc'],
      excludedSubSourceIds: ['bbc_world']
    };

    renderHook(() => useTopicRefreshSocket({ onTopicRefresh, onSummariesRefresh, onNewsUpdate, subscription }));

    expect(io).toHaveBeenCalledWith(window.location.origin, expect.not.objectContaining({
      reconnectionAttempts: expect.any(Number)
    }));

    handlers.get('news:update')({ refresh: true, reason: 'news' });
    handlers.get('news:update')({ count: 1, groupIds: ['group-1'], data: [{ id: 'group-1' }] });
    handlers.get('news:update')({ refresh: true, reason: 'topics' });
    handlers.get('news:update')({ refresh: true, reason: 'summaries' });

    expect(socket.emit).toHaveBeenCalledWith('subscribe:filters', subscription);
    expect(onNewsUpdate).toHaveBeenCalledTimes(1);
    expect(onNewsUpdate).toHaveBeenCalledWith(expect.objectContaining({ groupIds: ['group-1'] }));
    expect(onTopicRefresh).toHaveBeenCalledTimes(2);
    expect(onTopicRefresh).toHaveBeenCalledWith({ refresh: true, reason: 'news' });
    expect(onTopicRefresh).toHaveBeenCalledWith({ refresh: true, reason: 'topics' });
    expect(onSummariesRefresh).toHaveBeenCalledTimes(1);
    expect(onSummariesRefresh).toHaveBeenCalledWith({ refresh: true, reason: 'summaries' });
  });

  test('resubscribes current filters after socket reconnect', () => {
    const subscription = { search: 'markets', topics: ['Economy'] };

    const { rerender } = renderHook(({ nextSubscription }) => useTopicRefreshSocket({
      onTopicRefresh: vi.fn(),
      subscription: nextSubscription
    }), {
      initialProps: { nextSubscription: subscription }
    });

    const updatedSubscription = { search: 'science', topics: ['Science'] };
    rerender({ nextSubscription: updatedSubscription });

    handlers.get('connect')();

    expect(socket.emit).toHaveBeenLastCalledWith('subscribe:filters', updatedSubscription);
  });

  test('does not connect while disabled', () => {
    const { rerender } = renderHook(({ enabled }) => useTopicRefreshSocket({
      onTopicRefresh: vi.fn(),
      enabled
    }), {
      initialProps: { enabled: false }
    });

    expect(io).not.toHaveBeenCalled();

    rerender({ enabled: true });

    expect(io).toHaveBeenCalledTimes(1);
  });

  test('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useTopicRefreshSocket({ onTopicRefresh: vi.fn() }));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(socket.off).toHaveBeenCalledWith('news:update', expect.any(Function));
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
