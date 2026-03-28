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
    emit: jest.fn()
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
      findSessionByTokenHash: jest.fn(),
      touchUserActivity: jest.fn()
    };
    authMock = {
      extractBearerToken: jest.fn(() => ''),
      hashSessionToken: jest.fn((token) => `hashed:${token}`),
      purgeExpiredSessionsIfNeeded: jest.fn()
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

    databaseMock.findSessionByTokenHash.mockReturnValue({
      userId: 'user-1',
      username: 'alice',
      expiresAt: '2999-01-01T00:00:00.000Z'
    });

    ioMock.middleware(socket, next);

    expect(authMock.purgeExpiredSessionsIfNeeded).toHaveBeenCalled();
    expect(authMock.hashSessionToken).toHaveBeenCalledWith('session-token');
    expect(socket.data).toMatchObject({ userId: 'user-1', username: 'alice' });
    expect(next).toHaveBeenCalledWith();
  });

  test('rejects sockets without a valid session token', () => {
    const socket = createSocket('socket-2', {
      auth: {},
      headers: {}
    });
    const next = jest.fn();

    ioMock.middleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication required' }));
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
});
