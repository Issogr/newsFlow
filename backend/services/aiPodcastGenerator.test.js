const aiPodcastGenerator = require('./aiPodcastGenerator');

function createTestWavBuffer(byteLength = 2048) {
  const buffer = Buffer.alloc(Math.max(44, byteLength));
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24000, 24);
  buffer.writeUInt32LE(48000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(buffer.length - 44, 40);
  return buffer;
}

function createTestPcmBuffer(byteLength = 2400, sampleValue = 1000) {
  const buffer = Buffer.alloc(byteLength + (byteLength % 2));
  for (let offset = 0; offset + 2 <= buffer.length; offset += 2) {
    buffer.writeInt16LE(sampleValue, offset);
  }
  return buffer;
}

describe('aiPodcastGenerator', () => {
  const originalEnv = process.env;

  afterEach(() => {
    aiPodcastGenerator._setAudioSpeechHttpClient(null);
    process.env = originalEnv;
  });

  test('builds a podcast prompt for enabled languages from every provided article', () => {
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

    expect(prompt).toContain('Generate only the enabled language: English');
    expect(prompt).toContain('Act as the writer, editor, and producer for a daily news podcast with one narrator');
    expect(prompt).toContain('Make editorial choices');
    expect(prompt).toContain('opening hook, essential context, main fact, why it matters, what could happen next');
    expect(prompt).toContain('Connect sections with smooth transitions');
    expect(prompt).toContain('what to keep an eye on');
    expect(prompt).toContain('Skip promotional shopping deals');
    expect(prompt).toContain('do not mention the same news twice');
    expect(prompt).toContain('Do not name the title or opening after a time of day');
    expect(prompt).toContain('Use short paragraphs separated by blank lines');
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

  test('removes inferred time-of-day labels from generated podcast title and opening', () => {
    const normalized = aiPodcastGenerator._normalizeGeneratedPodcast({
      en: {
        title: 'Noon news update',
        script: 'Welcome to the midday news update. First story follows.'
      },
      it: {
        title: 'Notiziario di Mezzogiorno',
        script: 'Benvenuti all\'aggiornamento di mezzogiorno. Prima notizia.'
      }
    }, { locales: ['en', 'it'] });

    expect(normalized.titleByLocale.en).toBe('News briefing');
    expect(normalized.titleByLocale.it).toBe('Briefing notizie');
    expect(normalized.scriptTextByLocale.en).toBe('Welcome to the news update. First story follows.');
    expect(normalized.scriptTextByLocale.it).toBe('Benvenuti all\'aggiornamento delle notizie. Prima notizia.');
  });

  test('removes promotional price-drop sentences from generated podcast scripts', () => {
    const normalized = aiPodcastGenerator._normalizeGeneratedPodcast({
      en: {
        title: 'News briefing',
        script: 'The opening story covers transport policy. Finally, for travelers, the Twelve South AirFly Pro 2 Bluetooth adapter reached one of its best prices before summer travel. The closing story covers science.'
      },
      it: {
        title: 'Briefing notizie',
        script: 'La prima notizia riguarda i trasporti. Infine, per i viaggiatori, l\'adattatore Bluetooth AirFly Pro 2 di Twelve South ha raggiunto uno dei suoi prezzi migliori in vista dei viaggi estivi. La chiusura riguarda la scienza.'
      }
    }, { locales: ['en', 'it'] });

    expect(normalized.scriptTextByLocale.en).toBe('The opening story covers transport policy. The closing story covers science.');
    expect(normalized.scriptTextByLocale.it).toBe('La prima notizia riguarda i trasporti. La chiusura riguarda la scienza.');
  });

  test('validates generated podcast scripts for speakable output', () => {
    const validScript = 'This briefing opens with a clear summary of the main story and then moves through the important context in natural spoken language. It closes with a short, direct ending for listeners.';

    expect(() => aiPodcastGenerator._validateGeneratedPodcast({
      scriptTextByLocale: {
        en: `${validScript} Reference [1].`,
        it: 'Questa sintesi apre con il contesto principale e prosegue con una spiegazione naturale per l\'ascolto. Si chiude con una frase breve e chiara.'
      }
    }, 1, { locales: ['en', 'it'] })).toThrow('bracket citations');

    expect(() => aiPodcastGenerator._validateGeneratedPodcast({
      scriptTextByLocale: {
        en: `- ${validScript}`,
        it: 'Questa sintesi apre con il contesto principale e prosegue con una spiegazione naturale per l\'ascolto. Si chiude con una frase breve e chiara.'
      }
    }, 1, { locales: ['en', 'it'] })).toThrow('non-speakable formatting');

    expect(() => aiPodcastGenerator._validateGeneratedPodcast({
      scriptTextByLocale: {
        en: validScript,
        it: validScript
      }
    }, 1, { locales: ['en', 'it'] })).toThrow('identical');
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

  test.each([
    {
      name: 'feature-specific model configs',
      env: {
        OPENROUTER_PODCAST_SCRIPT_MODEL: 'podcast-script-model',
        OPENROUTER_PODCAST_AUDIO_MODEL: 'podcast-audio-model'
      },
      scriptModel: 'podcast-script-model',
      ttsModel: 'podcast-audio-model',
      enabled: true
    },
    {
      name: 'requested defaults when feature-specific env vars are unset',
      env: {
        OPENROUTER_PODCAST_SCRIPT_MODEL: undefined,
        OPENROUTER_PODCAST_AUDIO_MODEL: undefined
      },
      scriptModel: 'deepseek/deepseek-v4-flash',
      ttsModel: 'google/gemini-3.1-flash-tts-preview',
      enabled: true
    }
  ])('uses $name', ({ env, scriptModel, ttsModel, enabled }) => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      ...env
    };

    expect(aiPodcastGenerator._getScriptConfig()).toEqual(expect.objectContaining({
      enabled,
      model: scriptModel
    }));
    expect(aiPodcastGenerator._getTtsConfig()).toEqual(expect.objectContaining({
      enabled,
      model: ttsModel
    }));
  });

  test('defaults podcast generation to English and filters unsupported configured languages', () => {
    process.env = {
      ...originalEnv,
      AI_PODCAST_LANGUAGES: undefined
    };

    expect(aiPodcastGenerator._getEnabledPodcastLocales()).toEqual(['en']);

    process.env = {
      ...originalEnv,
      AI_PODCAST_LANGUAGES: 'it, en, fr, IT'
    };

    expect(aiPodcastGenerator._getEnabledPodcastLocales()).toEqual(['it', 'en']);
  });

  test('builds narration instructions for Italian and future supported locales', () => {
    expect(aiPodcastGenerator._getNarrationInstructions('it')).toContain('Italian single-narrator daily news podcast audio');
    expect(aiPodcastGenerator._getNarrationInstructions('fr')).toContain('French single-narrator daily news podcast audio');
    expect(aiPodcastGenerator._getNarrationInstructions('it')).toContain('matching the language of the provided script');
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

  test('splits Gemini TTS into stitched WAV chunks with short gaps', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      AI_PODCAST_TTS_CHUNK_MAX_BYTES: '500',
      AI_PODCAST_TTS_CHUNK_SILENCE_MS: '10'
    };
    let callIndex = 0;
    const pcmByteLength = 2400;
    const httpClient = {
      post: jest.fn().mockImplementation(() => {
        callIndex += 1;
        return Promise.resolve({
          status: 200,
          headers: { 'content-type': 'audio/pcm' },
          data: createTestPcmBuffer(pcmByteLength, 1000 + callIndex)
        });
      })
    };
    const sentence = 'La Francia ha comunicato una decisione politica importante e il servizio spiega il contesto per gli ascoltatori.';
    const longScript = `${sentence} ${sentence} ${sentence}\n\n${sentence} ${sentence} ${sentence}\n\n${sentence} ${sentence} ${sentence}`;
    aiPodcastGenerator._setAudioSpeechHttpClient(httpClient);

    const audio = await aiPodcastGenerator._generateItalianAudio(longScript);

    expect(httpClient.post.mock.calls.length).toBeGreaterThan(1);
    httpClient.post.mock.calls.forEach((call) => {
      const input = call[1].input;
      expect(Buffer.byteLength(input, 'utf8')).toBeLessThanOrEqual(500);
      expect(input).not.toMatch(/\n/u);
      expect(call[1]).toEqual(expect.objectContaining({ response_format: 'pcm' }));
    });
    const wavBytes = Buffer.from(audio.data, 'base64');
    const silenceBytesPerGap = 480;
    const expectedDataBytes = (httpClient.post.mock.calls.length * pcmByteLength)
      + ((httpClient.post.mock.calls.length - 1) * silenceBytesPerGap);
    expect(audio.mimeType).toBe('audio/wav');
    expect(wavBytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wavBytes.readUInt32LE(40)).toBe(expectedDataBytes);
  });

  test('allows longer Gemini TTS scripts that need ten stitched chunks', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      AI_PODCAST_TTS_CHUNK_MAX_BYTES: '300'
    };
    const pcmByteLength = 2400;
    const httpClient = {
      post: jest.fn().mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'audio/pcm' },
        data: createTestPcmBuffer(pcmByteLength)
      })
    };
    const paragraph = 'Questa parte del podcast spiega una notizia importante con contesto chiaro, conseguenze pratiche, una transizione naturale per chi ascolta e un dettaglio finale che mantiene il racconto parlato fluido.';
    const longScript = Array.from({ length: 10 }, () => paragraph).join('\n\n');
    aiPodcastGenerator._setAudioSpeechHttpClient(httpClient);

    const audio = await aiPodcastGenerator._generateItalianAudio(longScript);

    expect(httpClient.post).toHaveBeenCalledTimes(10);
    expect(audio.mimeType).toBe('audio/wav');
    expect(Buffer.from(audio.data, 'base64').subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  test('uses the OpenRouter audio speech endpoint for Italian TTS', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_PODCAST_AUDIO_MODEL: 'tts-model',
      AI_PODCAST_TTS_FORMAT: 'wav',
      AI_PODCAST_TTS_VOICE: 'Puck'
    };
    const audioBytes = createTestWavBuffer();
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
        instructions: expect.stringContaining('Italian single-narrator daily news podcast audio')
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
    expect(httpClient.post.mock.calls[0][1].instructions).toContain('measured pace');
    expect(httpClient.post.mock.calls[0][1].instructions).toContain('Do not add music, sound effects, extra words, or translation');
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

  test('rejects overlong non-stitchable TTS input before calling the provider', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_PODCAST_AUDIO_MODEL: 'tts-model',
      AI_PODCAST_TTS_MAX_INPUT_BYTES: '1000'
    };
    const httpClient = { post: jest.fn() };
    aiPodcastGenerator._setAudioSpeechHttpClient(httpClient);

    await expect(aiPodcastGenerator._generateItalianAudio('Testo podcast italiano. '.repeat(200)))
      .rejects.toThrow('TTS input is too long');
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  test('rejects tiny or malformed TTS audio responses', async () => {
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'test-key'
    };
    aiPodcastGenerator._setAudioSpeechHttpClient({
      post: jest.fn().mockResolvedValue({
        status: 200,
        headers: { 'content-type': 'audio/wav' },
        data: Buffer.from('RIFF broken')
      })
    });

    await expect(aiPodcastGenerator._generateItalianAudio('Testo podcast italiano'))
      .rejects.toThrow('audio is too small');
  });
});
