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
      disconnect: vi.fn()
    };
    io.mockReturnValue(socket);
  });

  test('notifies only topic refresh events', () => {
    const onTopicRefresh = vi.fn();

    renderHook(() => useTopicRefreshSocket(onTopicRefresh));

    handlers.get('news:update')({ refresh: true, reason: 'news' });
    handlers.get('news:update')({ count: 1, data: [{ id: 'group-1' }] });
    handlers.get('news:update')({ refresh: true, reason: 'topics' });

    expect(onTopicRefresh).toHaveBeenCalledTimes(1);
    expect(onTopicRefresh).toHaveBeenCalledWith({ refresh: true, reason: 'topics' });
  });

  test('disconnects on unmount', () => {
    const { unmount } = renderHook(() => useTopicRefreshSocket(vi.fn()));

    unmount();

    expect(socket.off).toHaveBeenCalledWith('news:update', expect.any(Function));
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
  });
});
