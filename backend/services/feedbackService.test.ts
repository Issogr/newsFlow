describe('feedbackService', () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
      FEEDBACK_DELIVERY_TIMEOUT_MS: '1000',
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      TELEGRAM_CHAT_ID: '-1001234567890',
      TELEGRAM_MESSAGE_THREAD_ID: '2',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test.each([
    {
      name: 'text-only feedback',
      feedback: {
        user: { id: 'user-1', username: 'alice' },
        category: 'feedback',
        title: 'Topic routing',
        description: 'Send this into the configured forum topic.',
      },
      endpoints: ['/sendMessage']
    },
    {
      name: 'feedback with a video attachment',
      feedback: {
        user: { id: 'user-2', username: 'bob' },
        category: 'bug',
        title: 'Attachment topic routing',
        description: 'Attach this to the configured topic too.',
        attachment: {
          originalname: 'demo.mp4',
          mimetype: 'video/mp4',
          buffer: Buffer.from('video-content'),
        },
      },
      endpoints: ['/sendVideo', '/sendMessage']
    }
  ])('includes the forum topic id for $name', async ({ feedback, endpoints }) => {
    const fetchMock = jest.fn();
    endpoints.forEach((endpoint, index) => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 10 + index } }),
      });
    });
    globalThis.fetch = fetchMock;

    const { sendFeedback } = require('./feedbackService');

    await sendFeedback(feedback);

    expect(fetchMock).toHaveBeenCalledTimes(endpoints.length);
    endpoints.forEach((endpoint, index) => {
      expect(fetchMock.mock.calls[index][0]).toContain(endpoint);
      expect(fetchMock.mock.calls[index][1].body.get('chat_id')).toBe('-1001234567890');
      expect(fetchMock.mock.calls[index][1].body.get('message_thread_id')).toBe('2');
    });
  });

  test('uses an abort deadline for Telegram delivery failures', async () => {
    const fetchMock = jest.fn((url, options) => {
      expect(options.signal).toBeInstanceOf(globalThis.AbortSignal);
      return Promise.reject(new globalThis.DOMException('Timed out', 'TimeoutError'));
    });
    globalThis.fetch = fetchMock;
    const { sendFeedback } = require('./feedbackService');

    await expect(sendFeedback({
      user: { id: 'user-1', username: 'alice' },
      category: 'bug',
      title: 'Slow delivery',
      description: 'Telegram did not respond.'
    })).rejects.toMatchObject({ code: 'FEEDBACK_DELIVERY_FAILED' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
