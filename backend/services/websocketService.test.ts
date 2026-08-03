const createMockLogger = require('../test-utils/mockLogger');
import type { Mock } from 'vitest';

type Handler = (...args: unknown[]) => unknown;

interface SocketMock {
  id: string;
  handshake: Record<string, unknown>;
  data: Record<string, string>;
  handlers: Record<string, Handler>;
  on: Mock;
  emit: Mock;
  disconnect: Mock;
}

interface IoMock {
  middleware: Handler | null;
  connectionHandler: Handler | null;
  use: Mock;
  on: Mock;
}

type MockModule = Record<string, Mock>;

function createSocket(id: string, handshake: Record<string, unknown> = {}): SocketMock {
  const handlers: Record<string, Handler> = {};

  return {
    id,
    handshake,
    data: {},
    handlers,
    on: jest.fn((event: string, handler: Handler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn(),
    disconnect: jest.fn()
  };
}

describe('websocketService', () => {
  let ioMock: IoMock;
  let socketFactory: Mock;
  let databaseMock: MockModule;
  let authMock: MockModule;
  let websocketService: ReturnType<typeof require>;

  beforeEach(() => {
    jest.resetModules();

    ioMock = {
      middleware: null,
      connectionHandler: null,
      use: jest.fn((handler: Handler) => {
        ioMock.middleware = handler;
      }),
      on: jest.fn((event: string, handler: Handler) => {
        if (event === 'connection') {
          ioMock.connectionHandler = handler;
        }
      })
    };

    socketFactory = jest.fn(() => ioMock);
    databaseMock = {
      findSessionByTokenHash: jest.fn(() => null),
      listUserSources: jest.fn(() => []),
      touchUserActivity: jest.fn()
    };
    authMock = {
      resolveAuthenticatedSession: jest.fn(() => ({
        session: {
          tokenHash: 'session-hash-1',
          expiresAt: new Date(Date.now() + 60000).toISOString()
        },
        user: {
          id: 'user-1',
          username: 'alice'
        }
      }))
    };

    jest.doMock('socket.io', () => socketFactory);
    jest.doMock('../utils/logger', createMockLogger);
    jest.doMock('../utils/networkConfig', () => ({
      getAllowedOrigins: jest.fn(() => ['http://localhost:3000']),
      isOriginAllowed: jest.fn(() => true)
    }));
    jest.doMock('./database', () => databaseMock);
    jest.doMock('../utils/auth', () => authMock);

    websocketService = require('./websocketService');
    websocketService.initialize({});
  });

  test('authenticates a socket from its backend session cookie and ignores auth payload tokens', () => {
    const socket = createSocket('socket-1', {
      auth: { token: 'legacy-session-token' },
      headers: { cookie: 'newsflow_session=cookie-token' }
    });
    const next = jest.fn();

    ioMock.middleware!(socket, next);

    expect(authMock.resolveAuthenticatedSession).toHaveBeenCalledWith({
      headers: { cookie: 'newsflow_session=cookie-token' },
      touchActivitySeconds: 60
    });
    expect(socket.data).toMatchObject({
      userId: 'user-1',
      username: 'alice',
      sessionTokenHash: 'session-hash-1'
    });
    expect(next).toHaveBeenCalledWith();
  });

  test('rejects sockets without a valid session token', () => {
    const socket = createSocket('socket-2', {
      auth: {},
      headers: {}
    });
    const next = jest.fn();

    authMock.resolveAuthenticatedSession.mockImplementation(() => {
      throw new Error('Authentication required');
    });

    ioMock.middleware!(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'WebSocket auth failed: Authentication required' }));
  });

  test('rejects websocket handshakes that do not come through the trusted proxy', () => {
    const allowRequest = socketFactory.mock.calls[0][1].allowRequest;
    const callback = jest.fn();

    allowRequest({ headers: { origin: 'http://localhost:3000' } }, callback);

    expect(callback).toHaveBeenCalledWith('Origin not allowed', false);
  });

  test('broadcasts news only to matching sockets', () => {
    const socketOne = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socketOne.data.userId = 'user-1';
    const socketTwo = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    socketTwo.data.userId = 'user-2';

    ioMock.connectionHandler!(socketOne);
    ioMock.connectionHandler!(socketTwo);

    socketOne.handlers['subscribe:filters']({ topics: ['Politics'], sourceIds: ['ansa'] });
    socketTwo.handlers['subscribe:filters']({ topics: ['Science'], sourceIds: ['bbc'] });

    websocketService.broadcastNewsUpdate([
      {
        id: 'group-1',
        ownerUserId: 'user-1',
        topics: ['Politics'],
        items: [{ sourceId: 'ansa' }]
      },
      {
        id: 'group-2',
        ownerUserId: 'user-2',
        topics: ['Science'],
        items: [{ sourceId: 'bbc' }]
      }
    ]);

    const socketOnePayload = socketOne.emit.mock.calls[0][1];
    const socketTwoPayload = socketTwo.emit.mock.calls[0][1];
    expect(socketOnePayload).toEqual({
      count: 1,
      groupIds: ['group-1'],
      timestamp: expect.any(String)
    });
    expect(socketTwoPayload).toEqual({
      count: 1,
      groupIds: ['group-2'],
      timestamp: expect.any(String)
    });
  });

  test('matches private custom-source updates against domain source filters', () => {
    const socket = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socket.data.userId = 'user-1';
    databaseMock.listUserSources.mockReturnValue([
      {
        id: 'custom-feed-1',
        name: 'Daily Example',
        url: 'https://feeds.example.com/rss.xml',
        language: 'en',
        userId: 'user-1',
        isActive: true
      }
    ]);

    ioMock.connectionHandler!(socket);
    socket.handlers['subscribe:filters']({ sourceIds: ['example.com'] });

    websocketService.broadcastNewsUpdate([
      {
        id: 'group-1',
        ownerUserId: 'user-1',
        topics: ['Economia'],
        items: [{ sourceId: 'custom-feed-1', source: 'Daily Example' }]
      }
    ]);

    expect(socket.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      groupIds: ['group-1']
    }));
  });

  test('matches news updates against search and recent-hours subscriptions', () => {
    const matchingSocket = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    matchingSocket.data.userId = 'user-1';
    const staleSocket = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    staleSocket.data.userId = 'user-1';

    ioMock.connectionHandler!(matchingSocket);
    ioMock.connectionHandler!(staleSocket);

    matchingSocket.handlers['subscribe:filters']({ search: 'economy', recentHours: 2 });
    staleSocket.handlers['subscribe:filters']({ search: 'economy', recentHours: 1 });

    websocketService.broadcastNewsUpdate([
      {
        id: 'group-1',
        ownerUserId: 'user-1',
        title: 'Economy rebounds at close',
        description: 'Markets finish higher after a volatile session.',
        pubDate: new Date(Date.now() - (30 * 60 * 1000)).toISOString(),
        topics: ['Economy'],
        items: [{ sourceId: 'ansa', title: 'Economy rebounds at close' }]
      },
      {
        id: 'group-2',
        ownerUserId: 'user-1',
        title: 'Economy outlook last week',
        description: 'A stale market wrap.',
        pubDate: new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString(),
        topics: ['Economy'],
        items: [{ sourceId: 'ansa', title: 'Economy outlook last week' }]
      }
    ]);

    expect(matchingSocket.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      groupIds: ['group-1']
    }));
    expect(staleSocket.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      groupIds: ['group-1']
    }));
  });

  test('does not broadcast groups from excluded sources or sub-sources', () => {
    const socket = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socket.data.userId = 'user-1';

    ioMock.connectionHandler!(socket);

    socket.handlers['subscribe:filters']({
      excludedSourceIds: ['ansa'],
      excludedSubSourceIds: ['ansa_world']
    });

    websocketService.broadcastNewsUpdate([
      {
        id: 'group-1',
        ownerUserId: 'user-1',
        topics: ['Politics'],
        items: [{ sourceId: 'ansa', rawSourceId: 'ansa_politics' }]
      },
      {
        id: 'group-2',
        ownerUserId: 'user-1',
        topics: ['Politics'],
        items: [{ sourceId: 'reuters', rawSourceId: 'ansa_world' }]
      }
    ]);

    expect(socket.emit).not.toHaveBeenCalled();
  });

  test('deduplicates repeated group ids in a single broadcast payload', () => {
    const socket = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socket.data.userId = 'user-1';

    ioMock.connectionHandler!(socket);

    websocketService.broadcastNewsUpdate([
      {
        id: 'group-1',
        ownerUserId: 'user-1',
        topics: ['Politics'],
        items: [{ sourceId: 'ansa' }]
      },
      {
        id: 'group-1',
        ownerUserId: 'user-1',
        topics: ['Politics'],
        items: [{ sourceId: 'ansa' }]
      }
    ]);

    expect(socket.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      groupIds: ['group-1']
    }));
    expect(socket.emit.mock.calls[0][1]).not.toHaveProperty('data');
  });

  test('broadcasts feed refresh events only to targeted users', () => {
    const socketOne = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socketOne.data.userId = 'user-1';
    const socketTwo = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    socketTwo.data.userId = 'user-2';

    ioMock.connectionHandler!(socketOne);
    ioMock.connectionHandler!(socketTwo);

    websocketService.broadcastFeedRefresh({ userIds: ['user-1'], reason: 'topics' });

    expect(socketOne.emit).toHaveBeenCalledWith('news:update', {
      count: 1,
      groupIds: [],
      refresh: true,
      reason: 'topics',
      timestamp: expect.any(String)
    });
    expect(socketTwo.emit).not.toHaveBeenCalled();
  });

  test('tracks failed emits during feed refresh broadcasts', () => {
    const failingSocket = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    failingSocket.emit.mockImplementation(() => {
      throw new Error('socket emit failed');
    });

    ioMock.connectionHandler!(failingSocket);

    websocketService.broadcastFeedRefresh();

    const statistics = websocketService.getStatistics();
    expect(statistics.activeConnectionsCount).toBe(1);
    expect(statistics.failedBroadcasts).toBe(1);
  });

  test('disconnects active sockets for a deleted user immediately', () => {
    const socketOne = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socketOne.data.userId = 'user-1';
    const socketTwo = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    socketTwo.data.userId = 'user-2';

    ioMock.connectionHandler!(socketOne);
    ioMock.connectionHandler!(socketTwo);

    const disconnected = websocketService.disconnectUserSockets('user-1');

    expect(disconnected).toBe(1);
    expect(socketOne.disconnect).toHaveBeenCalledWith(true);
    expect(socketTwo.disconnect).not.toHaveBeenCalled();
    expect(websocketService.getStatistics().activeConnectionsCount).toBe(1);
  });

  test('disconnects only sockets authenticated by a revoked session', () => {
    const socketOne = createSocket('socket-1');
    socketOne.data = { userId: 'user-1', sessionTokenHash: 'session-hash-1' };
    const socketTwo = createSocket('socket-2');
    socketTwo.data = { userId: 'user-1', sessionTokenHash: 'session-hash-2' };
    ioMock.connectionHandler!(socketOne);
    ioMock.connectionHandler!(socketTwo);

    expect(websocketService.disconnectSessionSockets('session-hash-1')).toBe(1);
    expect(socketOne.disconnect).toHaveBeenCalledWith(true);
    expect(socketTwo.disconnect).not.toHaveBeenCalled();
  });

  test('disconnects a socket when its persisted session expires', () => {
    jest.useFakeTimers();
    const socket = createSocket('socket-1');
    socket.data = {
      userId: 'user-1',
      sessionTokenHash: 'expired-session',
      sessionExpiresAt: new Date(Date.now() + 1000).toISOString()
    };
    databaseMock.findSessionByTokenHash.mockReturnValue(null);

    try {
      ioMock.connectionHandler!(socket);
      jest.advanceTimersByTime(1000);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    } finally {
      jest.useRealTimers();
    }
  });
});
