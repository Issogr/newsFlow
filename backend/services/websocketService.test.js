function createSocket(id, handshake = {}) {
  const handlers = {};

  return {
    id,
    handshake,
    data: {},
    handlers,
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn(),
    disconnect: jest.fn()
  };
}

describe('websocketService', () => {
  let ioMock;
  let socketFactory;
  let databaseMock;
  let authMock;
  let websocketService;

  beforeEach(() => {
    jest.resetModules();

    ioMock = {
      middleware: null,
      connectionHandler: null,
      use: jest.fn((handler) => {
        ioMock.middleware = handler;
      }),
      on: jest.fn((event, handler) => {
        if (event === 'connection') {
          ioMock.connectionHandler = handler;
        }
      })
    };

    socketFactory = jest.fn(() => ioMock);
    databaseMock = {
      touchUserActivity: jest.fn()
    };
    authMock = {
      resolveAuthenticatedSession: jest.fn(() => ({
        user: {
          id: 'user-1',
          username: 'alice'
        }
      }))
    };

    jest.doMock('socket.io', () => socketFactory);
    jest.doMock('../utils/logger', () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }));
    jest.doMock('../utils/networkConfig', () => ({
      getAllowedOrigins: jest.fn(() => ['http://localhost:3000']),
      isOriginAllowed: jest.fn(() => true)
    }));
    jest.doMock('./database', () => databaseMock);
    jest.doMock('../utils/auth', () => authMock);

    websocketService = require('./websocketService');
    websocketService.initialize({});
  });

  test('authenticates a socket and stores the user context', () => {
    const socket = createSocket('socket-1', {
      auth: { token: 'session-token' },
      headers: {}
    });
    const next = jest.fn();

    ioMock.middleware(socket, next);

    expect(authMock.resolveAuthenticatedSession).toHaveBeenCalledWith(expect.objectContaining({
      authToken: 'session-token',
      touchActivitySeconds: 60
    }));
    expect(socket.data).toMatchObject({ userId: 'user-1', username: 'alice' });
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

    ioMock.middleware(socket, next);

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

    ioMock.connectionHandler(socketOne);
    ioMock.connectionHandler(socketTwo);

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

    expect(socketOne.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      data: [expect.objectContaining({ id: 'group-1' })]
    }));
    expect(socketTwo.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      data: [expect.objectContaining({ id: 'group-2' })]
    }));
  });

  test('matches news updates against search and recent-hours subscriptions', () => {
    const matchingSocket = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    matchingSocket.data.userId = 'user-1';
    const staleSocket = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    staleSocket.data.userId = 'user-1';

    ioMock.connectionHandler(matchingSocket);
    ioMock.connectionHandler(staleSocket);

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

    ioMock.connectionHandler(socket);

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

    ioMock.connectionHandler(socket);

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
      groupIds: ['group-1'],
      data: [expect.objectContaining({ id: 'group-1' })]
    }));
  });

  test('broadcasts feed refresh events only to targeted users', () => {
    const socketOne = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socketOne.data.userId = 'user-1';
    const socketTwo = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    socketTwo.data.userId = 'user-2';

    ioMock.connectionHandler(socketOne);
    ioMock.connectionHandler(socketTwo);

    websocketService.broadcastFeedRefresh({ userIds: ['user-1'], reason: 'topics' });

    expect(socketOne.emit).toHaveBeenCalledWith('news:update', expect.objectContaining({
      count: 1,
      refresh: true,
      reason: 'topics'
    }));
    expect(socketTwo.emit).not.toHaveBeenCalled();
  });

  test('broadcasts notifications to all active sockets and tracks failed emits', () => {
    const healthySocket = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    const failingSocket = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    failingSocket.emit.mockImplementation(() => {
      throw new Error('socket emit failed');
    });

    ioMock.connectionHandler(healthySocket);
    ioMock.connectionHandler(failingSocket);

    websocketService.broadcastSystemNotification('Hello sockets', 'warning');

    expect(healthySocket.emit).toHaveBeenCalledWith('system:notification', expect.objectContaining({
      notificationType: 'warning',
      message: 'Hello sockets'
    }));

    const statistics = websocketService.getStatistics();
    expect(statistics.activeConnectionsCount).toBe(2);
    expect(statistics.failedBroadcasts).toBe(1);
  });

  test('disconnects active sockets for a deleted user immediately', () => {
    const socketOne = createSocket('socket-1', { auth: { token: 'token-1' }, headers: {} });
    socketOne.data.userId = 'user-1';
    const socketTwo = createSocket('socket-2', { auth: { token: 'token-2' }, headers: {} });
    socketTwo.data.userId = 'user-2';

    ioMock.connectionHandler(socketOne);
    ioMock.connectionHandler(socketTwo);

    const disconnected = websocketService.disconnectUserSockets('user-1');

    expect(disconnected).toBe(1);
    expect(socketOne.disconnect).toHaveBeenCalledWith(true);
    expect(socketTwo.disconnect).not.toHaveBeenCalled();
    expect(websocketService.getStatistics().activeConnectionsCount).toBe(1);
  });
});
