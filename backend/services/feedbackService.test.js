describe('feedbackService', () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...originalEnv,
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

  test('includes the forum topic id when sending a text-only feedback message', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 10 } }),
    });
    globalThis.fetch = fetchMock;

    const { sendFeedback } = require('./feedbackService');

    await sendFeedback({
      user: { id: 'user-1', username: 'alice' },
      category: 'feedback',
      title: 'Topic routing',
      description: 'Send this into the configured forum topic.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/sendMessage');
    expect(fetchMock.mock.calls[0][1].body.get('chat_id')).toBe('-1001234567890');
    expect(fetchMock.mock.calls[0][1].body.get('message_thread_id')).toBe('2');
  });

  test('includes the forum topic id for attachment delivery and the follow-up message', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 11 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 12 } }),
      });
    globalThis.fetch = fetchMock;

    const { sendFeedback } = require('./feedbackService');

    await sendFeedback({
      user: { id: 'user-2', username: 'bob' },
      category: 'bug',
      title: 'Attachment topic routing',
      description: 'Attach this to the configured topic too.',
      attachment: {
        originalname: 'demo.mp4',
        mimetype: 'video/mp4',
        buffer: Buffer.from('video-content'),
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/sendVideo');
    expect(fetchMock.mock.calls[0][1].body.get('chat_id')).toBe('-1001234567890');
    expect(fetchMock.mock.calls[0][1].body.get('message_thread_id')).toBe('2');
    expect(fetchMock.mock.calls[1][0]).toContain('/sendMessage');
    expect(fetchMock.mock.calls[1][1].body.get('message_thread_id')).toBe('2');
  });
});
