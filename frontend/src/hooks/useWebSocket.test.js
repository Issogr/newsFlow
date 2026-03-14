import { act, renderHook } from '@testing-library/react';
import { io } from 'socket.io-client';
import useWebSocket from './useWebSocket';

jest.mock('socket.io-client', () => ({
  io: jest.fn()
}));

jest.mock('../services/api', () => ({
  getAuthToken: jest.fn(() => 'session-token')
}));

describe('useWebSocket', () => {
  let socket;
  let handlers;

  beforeEach(() => {
    handlers = {};
    socket = {
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      off: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
      io: {
        on: jest.fn(),
        off: jest.fn()
      }
    };

    io.mockReturnValue(socket);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('removes already visible groups from the pending badge count', () => {
    const { result } = renderHook(() => useWebSocket('http://localhost:3000', {
      newGroups: (count) => `${count} new groups`
    }));

    expect(io).toHaveBeenCalledWith('http://localhost:3000', expect.objectContaining({
      path: '/socket.io'
    }));

    act(() => {
      handlers['news:update']({
        count: 2,
        groupIds: ['group-1', 'group-2'],
        data: [{ id: 'group-1' }, { id: 'group-2' }],
        timestamp: '2026-03-14T10:00:00.000Z'
      });
    });

    expect(result.current.newArticlesCount).toBe(2);

    act(() => {
      result.current.markGroupsSeen(['group-1']);
    });

    expect(result.current.newArticlesCount).toBe(1);

    act(() => {
      result.current.markGroupsSeen(['group-2']);
    });

    expect(result.current.newArticlesCount).toBe(0);

    act(() => {
      handlers['news:update']({
        count: 2,
        groupIds: ['group-1', 'group-2'],
        data: [{ id: 'group-1' }, { id: 'group-2' }],
        timestamp: '2026-03-14T10:05:00.000Z'
      });
    });

    expect(result.current.newArticlesCount).toBe(0);
  });
});
