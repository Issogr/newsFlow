const aiPodcastGenerator = require('./aiPodcastGenerator');

describe('aiPodcastGenerator', () => {
  const originalEnv = process.env;

  afterEach(() => {
    aiPodcastGenerator._setAudioSpeechHttpClient(null);
    process.env = originalEnv;
  });

  test('builds a bilingual podcast prompt from every provided article', () => {
    const prompt = aiPodcastGenerator._buildPrompt({
      periodStart: '2026-05-21T07:00:00.000Z',
      periodEnd: '2026-05-21T13:00:00.000Z'
    }, [
      {
        id: 'article-1',
        title: 'First story',
        description: 'RSS description',
        readerText: 'Cached article text with enough context.',
        source: 'BBC',
        pubDate: '2026-05-21T08:00:00.000Z',
        url: 'https://example.com/first'
      },
      {
        id: 'article-2',
        title: 'Second story',
        description: 'Second RSS description',
        source: 'Wired',
        pubDate: '2026-05-21T09:00:00.000Z',
        url: 'https://example.com/second'
      }
    ]);
    const payload = JSON.parse(prompt.split('\n').at(-1));

    expect(prompt).toContain('Generate both supported languages: English and Italian');
    expect(payload.articles).toHaveLength(2);
    expect(payload.articles[0]).toEqual(expect.objectContaining({
      ref: 1,
      description: 'Cached article text with enough context.',
      contentType: 'cached_reader_text'
    }));
    expect(payload.articles[1]).toEqual(expect.objectContaining({
      ref: 2,
      contentType: 'rss_metadata'
    }));
    expect(payload.articles[0]).not.toHaveProperty('id');
    expect(payload.articles[0]).not.toHaveProperty('url');
  });

  test('extracts base64 audio payloads from OpenRouter-style responses', () => {
    const audio = aiPodcastGenerator._extractAudioPayload({
      choices: [
        {
          message: {
            audio: {
              data: 'data:audio/wav;base64,UklGRg==',
              mime_type: 'audio/mpeg'
            }
          }
        }
      ]
    });

    expect(audio).toEqual({
      data: 'UklGRg==',
      mimeType: 'audio/wav'
    });
  });

  test('uses the summary model config for script generation and separate TTS config for audio', () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_SUMMARY_MODEL: 'summary-model',
      OPENROUTER_TTS_MODEL: 'tts-model'
    };

    expect(aiPodcastGenerator._getScriptConfig()).toEqual(expect.objectContaining({
      enabled: true,
      model: 'summary-model'
    }));
    expect(aiPodcastGenerator._getTtsConfig()).toEqual(expect.objectContaining({
      enabled: true,
      model: 'tts-model'
    }));
  });

  test('defaults Gemini TTS to the Charon voice', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      AI_PODCAST_TTS_FORMAT: 'mp3'
    };
    const pcmBytes = Buffer.alloc(48000);
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'audio/pcm' },
        data: pcmBytes
      })
    };
    aiPodcastGenerator._setAudioSpeechHttpClient(httpClient);

    const audio = await aiPodcastGenerator._generateItalianAudio('Testo podcast italiano');

    expect(httpClient.post.mock.calls[0][1]).toEqual(expect.objectContaining({
      model: 'google/gemini-3.1-flash-tts-preview',
      voice: 'Charon',
      response_format: 'pcm'
    }));
    const wavBytes = Buffer.from(audio.data, 'base64');
    expect(audio.mimeType).toBe('audio/wav');
    expect(wavBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wavBytes.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wavBytes.readUInt32LE(24)).toBe(24000);
    expect(wavBytes.readUInt32LE(40)).toBe(pcmBytes.length);
  });

  test('uses the OpenRouter audio speech endpoint for Italian TTS', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_TTS_MODEL: 'tts-model',
      AI_PODCAST_TTS_FORMAT: 'wav',
      AI_PODCAST_TTS_VOICE: 'Puck'
    };
    const audioBytes = Buffer.from('RIFF test audio');
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'audio/wav' },
        data: audioBytes
      })
    };
    aiPodcastGenerator._setAudioSpeechHttpClient(httpClient);

    const audio = await aiPodcastGenerator._generateItalianAudio('Testo podcast italiano');

    expect(httpClient.post).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/audio/speech',
      expect.objectContaining({
        model: 'tts-model',
        input: 'Testo podcast italiano',
        voice: 'Puck',
        response_format: 'wav',
        instructions: expect.stringContaining('Italian')
      }),
      expect.objectContaining({
        responseType: 'arraybuffer',
        timeout: 120000,
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
          'X-Title': 'News Flow'
        }),
        validateStatus: expect.any(Function)
      })
    );
    expect(audio).toEqual(expect.objectContaining({
      data: audioBytes.toString('base64'),
      mimeType: 'audio/wav',
      model: 'tts-model',
      voice: 'Puck'
    }));
  });

  test('surfaces speech endpoint error messages', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key'
    };
    aiPodcastGenerator._setAudioSpeechHttpClient({
      post: jest.fn().mockResolvedValue({
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify({ error: { message: 'Unsupported voice' } }))
      })
    });

    await expect(aiPodcastGenerator._generateItalianAudio('Testo podcast italiano'))
      .rejects.toThrow('AI podcast TTS request failed (400): Unsupported voice');
  });

  test('includes OpenRouter provider metadata in speech errors', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key'
    };
    aiPodcastGenerator._setAudioSpeechHttpClient({
      post: jest.fn().mockResolvedValue({
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: Buffer.from(JSON.stringify({
          error: {
            message: 'Provider returned 400',
            metadata: { raw: 'Invalid voice: UnknownVoice' }
          }
        }))
      })
    });

    await expect(aiPodcastGenerator._generateItalianAudio('Testo podcast italiano'))
      .rejects.toThrow('AI podcast TTS request failed (400): Provider returned 400: Invalid voice: UnknownVoice');
  });
});
