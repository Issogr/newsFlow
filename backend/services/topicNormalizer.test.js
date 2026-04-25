const topicNormalizer = require('./topicNormalizer');

describe('topicNormalizer canonical taxonomy', () => {
  test('drops raw topics outside the supported taxonomy', () => {
    expect(topicNormalizer.normalizeTopic('home')).toBeNull();
    expect(topicNormalizer.normalizeTopic('home top')).toBeNull();
    expect(topicNormalizer.normalizeTopic('argomento')).toBeNull();
    expect(topicNormalizer.normalizeTopic('bits')).toBeNull();
  });

  test('maps known aliases to canonical topics', () => {
    expect(topicNormalizer.normalizeTopic('politics')).toBe('Politica');
    expect(topicNormalizer.normalizeTopic('markets')).toBe('Economia');
    expect(topicNormalizer.normalizeTopic('science')).toBe('Scienza');
  });

  test('does not map short AI aliases inside unrelated Italian words', () => {
    expect(topicNormalizer.normalizeTopic('aria compressa')).toBeNull();
    expect(topicNormalizer.normalizeTopic('notizia')).toBeNull();
    expect(topicNormalizer.normalizeTopic('AI')).toBe('Tecnologia');
  });

  test('classifies the air-gun protest example as cronaca, not technology', () => {
    const topics = topicNormalizer.extractTopics({
      title: 'A Roma due persone che partecipavano al corteo per il 25 aprile sono state ferite da colpi di pistola ad aria compressa'
    });

    expect(topics).toEqual(expect.arrayContaining(['Cronaca']));
    expect(topics).not.toEqual(expect.arrayContaining(['Tecnologia']));
  });

  test('extractTopics returns only canonical topics', () => {
    const topics = topicNormalizer.extractTopics({
      title: 'Trump e Meloni discutono i dazi e l economia',
      description: 'Vertice politico a Washington con focus su mercati e governo.'
    }, ['home', 'argomento', 'politics', 'bits']);

    expect(topics).toEqual(expect.arrayContaining(['Politica']));
    expect(topics).not.toEqual(expect.arrayContaining(['home', 'argomento', 'bits']));
    expect(topics.every((topic) => topicNormalizer.isCanonicalTopic(topic))).toBe(true);
  });
});
