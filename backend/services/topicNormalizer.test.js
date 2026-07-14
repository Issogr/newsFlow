const topicNormalizer = require('./topicNormalizer');
const topicRegressionFixtures = [
  { title: 'A Roma due persone al corteo del 25 aprile ferite da colpi di pistola ad aria compressa', expected: ['Cronaca', 'Politica'], rejected: ['Tecnologia'] },
  { title: 'Arrestato dopo una rapina in centro, indaga la procura', expected: ['Cronaca'], rejected: ['Economia'] },
  { title: 'Incidente in autostrada, tre feriti e traffico bloccato', expected: ['Cronaca'], rejected: ['Tecnologia'] },
  { title: 'La polizia sequestra armi e droga in un appartamento', expected: ['Cronaca'], rejected: ['Tecnologia'] },
  { title: 'Processo per corruzione, il tribunale ascolta nuovi testimoni', expected: ['Cronaca'], rejected: ['Spettacolo'] },
  { title: 'Il governo approva il nuovo decreto sul lavoro', expected: ['Politica', 'Economia'], rejected: ['Cronaca'] },
  { title: 'Elezioni regionali, i partiti presentano i candidati', expected: ['Politica'], rejected: ['Sport'] },
  { title: 'Il Parlamento discute la riforma fiscale', expected: ['Politica', 'Economia'], rejected: ['Cultura'] },
  { title: 'Inflazione in calo, la banca centrale valuta i tassi', expected: ['Economia'], rejected: ['Cronaca'] },
  { title: 'Borsa europea positiva dopo i dati sul Pil', expected: ['Economia'], rejected: ['Cronaca'] },
  { title: 'Aziende e sindacati firmano accordo sull occupazione', expected: ['Economia'], rejected: ['Spettacolo'] },
  { title: 'Nuovi chip per intelligenza artificiale nei data center', expected: ['Tecnologia'], rejected: ['Cronaca'] },
  { title: 'Cybersecurity, attacco hacker contro servizi cloud', expected: ['Tecnologia'], rejected: ['Esteri'] },
  { title: 'Startup italiana lancia una app per pagamenti digitali', expected: ['Tecnologia'], rejected: ['Economia'] },
  { title: 'La Nasa annuncia una nuova scoperta nello spazio', expected: ['Scienza'], rejected: ['Spettacolo'] },
  { title: 'Ricerca in laboratorio apre nuove prospettive sulla biologia', expected: ['Scienza'], rejected: ['Salute'] },
  { title: 'Studio scientifico misura gli effetti del cambiamento climatico', expected: ['Scienza', 'Ambiente'], rejected: ['Spettacolo'] },
  { title: 'Alluvione e meteo estremo, cresce l allarme clima', expected: ['Ambiente'], rejected: ['Cronaca'] },
  { title: 'Emissioni di CO2 in aumento nonostante le energie rinnovabili', expected: ['Ambiente'], rejected: ['Economia'] },
  { title: 'Siccita e biodiversita, nuovo piano per proteggere i fiumi', expected: ['Ambiente'], rejected: ['Sport'] },
  { title: 'Serie A, la partita finisce con tre gol nel finale', expected: ['Sport'], rejected: ['Politica'] },
  { title: 'Tennis, il campione vince il torneo dopo una maratona', expected: ['Sport'], rejected: ['Salute'] },
  { title: 'Formula 1, pole position decisiva per il gran premio', expected: ['Sport'], rejected: ['Tecnologia'] },
  { title: 'Mostra al museo celebra arte e letteratura contemporanea', expected: ['Cultura'], rejected: ['Spettacolo'] },
  { title: 'Nuovo romanzo dello scrittore vince il premio letterario', expected: ['Cultura'], rejected: ['Politica'] },
  { title: 'Teatro pieno per la prima dell opera alla Biennale', expected: ['Cultura'], rejected: ['Economia'] },
  { title: 'Ospedale sotto pressione per il nuovo virus influenzale', expected: ['Salute'], rejected: ['Cronaca'] },
  { title: 'Vaccino e farmaco sperimentale, i medici spiegano la terapia', expected: ['Salute'], rejected: ['Scienza'] },
  { title: 'Diagnosi precoce della malattia, nuovo protocollo sanitario', expected: ['Salute'], rejected: ['Tecnologia'] },
  { title: 'Ucraina e Russia riprendono i colloqui con la Nato', expected: ['Esteri'], rejected: ['Politica'] },
  { title: 'Gaza, Israele e Stati Uniti discutono una tregua', expected: ['Esteri'], rejected: ['Cronaca'] },
  { title: 'Cina e Unione europea aprono un tavolo diplomatico', expected: ['Esteri'], rejected: ['Economia'] },
  { title: 'Sanremo, il cantante annuncia il nuovo album', expected: ['Spettacolo'], rejected: ['Cultura'] },
  { title: 'Cinema, il film domina il box office del weekend', expected: ['Spettacolo'], rejected: ['Cronaca'] },
  { title: 'Serie tv con una attrice italiana arriva su Netflix', expected: ['Spettacolo'], rejected: ['Sport'] },
  { title: 'Borsa rubata in stazione, arrestato un uomo', expected: ['Cronaca'], rejected: ['Economia'] },
  { title: 'Lo studio legale presenta ricorso al tribunale', expected: ['Cronaca'], rejected: ['Scienza'] },
  { title: 'Energia rinnovabile, il governo presenta il nuovo piano', expected: ['Ambiente', 'Politica'], rejected: ['Economia'] },
  { title: 'La camera approva il decreto, protesta in piazza', expected: ['Politica'], rejected: ['Cultura'] },
  { title: 'Appalti pubblici, indagine della procura su una azienda', expected: ['Cronaca', 'Economia'], rejected: ['Tecnologia'] }
];

describe('topicNormalizer canonical taxonomy', () => {
  test('normalizes supported topic aliases and excludes unsupported raw topics', () => {
    expect(topicNormalizer.normalizeTopic('home')).toBeNull();
    expect(topicNormalizer.normalizeTopic('home top')).toBeNull();
    expect(topicNormalizer.normalizeTopic('argomento')).toBeNull();
    expect(topicNormalizer.normalizeTopic('bits')).toBeNull();
    expect(topicNormalizer.normalizeTopic('politics')).toBe('Politica');
    expect(topicNormalizer.normalizeTopic('markets')).toBe('Economia');
    expect(topicNormalizer.normalizeTopic('science')).toBe('Scienza');

    const topics = topicNormalizer.extractTopics({
      title: 'Trump e Meloni discutono i dazi e l economia',
      description: 'Vertice politico a Washington con focus su mercati e governo.'
    }, ['home', 'argomento', 'politics', 'bits']);

    expect(topics).toEqual(expect.arrayContaining(['Politica']));
    expect(topics).not.toEqual(expect.arrayContaining(['home', 'argomento', 'bits']));
    expect(topics.every((topic) => topicNormalizer.isCanonicalTopic(topic))).toBe(true);
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

  test('weighted topic fixtures classify representative difficult headlines', () => {
    topicRegressionFixtures.forEach((fixture) => {
      const topics = topicNormalizer.extractTopics({ title: fixture.title });

      expect(topics).toEqual(expect.arrayContaining(fixture.expected));
      expect(topics).not.toEqual(expect.arrayContaining(fixture.rejected));
    });
  });

  test('returns weighted classification details for debugging', () => {
    const details = topicNormalizer.extractTopicDetails({
      title: 'A Roma due persone al corteo del 25 aprile ferite da colpi di pistola ad aria compressa'
    });

    expect(details[0]).toEqual(expect.objectContaining({
      topic: 'Cronaca',
      source: 'local',
      evidence: expect.arrayContaining(['ferite', 'pistola'])
    }));
  });
});
