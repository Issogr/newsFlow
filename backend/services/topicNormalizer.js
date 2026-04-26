const CANONICAL_TOPICS = [
  'Politica',
  'Economia',
  'Tecnologia',
  'Scienza',
  'Ambiente',
  'Sport',
  'Cultura',
  'Salute',
  'Esteri',
  'Cronaca',
  'Spettacolo'
];

const TOPIC_ALIASES = {
  Politica: ['politica', 'politics', 'politique', 'governo', 'government', 'election', 'elezioni', 'parlamento', 'parliament'],
  Economia: ['economia', 'economy', 'business', 'mercati', 'markets', 'finanza', 'finance', 'borsa', 'inflazione'],
  Tecnologia: ['tecnologia', 'technology', 'tech', 'ai', 'ia', 'startup', 'software', 'cybersecurity', 'digitale', 'digital'],
  Scienza: ['scienza', 'science', 'ricerca', 'research', 'space', 'spazio', 'physics', 'biologia'],
  Ambiente: ['ambiente', 'environment', 'clima', 'climate', 'energia', 'energy', 'sostenibilita', 'sustainability'],
  Sport: ['sport', 'football', 'calcio', 'tennis', 'basket', 'olimpiadi', 'olympics', 'formula 1', 'motogp'],
  Cultura: ['cultura', 'culture', 'arte', 'art', 'libri', 'books', 'teatro', 'museum', 'museo'],
  Salute: ['salute', 'health', 'sanita', 'medicina', 'medicine', 'hospital', 'ospedale', 'vaccino', 'virus'],
  Esteri: ['esteri', 'international', 'world', 'mundo', 'monde', 'guerra', 'war', 'diplomacy', 'diplomazia'],
  Cronaca: ['cronaca', 'news', 'breaking', 'incident', 'crime', 'tribunale', 'court', 'police', 'polizia'],
  Spettacolo: ['spettacolo', 'entertainment', 'cinema', 'film', 'tv', 'televisione', 'music', 'musica', 'celebrity']
};

const TOPIC_SCORE_THRESHOLD = 3;

const TOPIC_RULES = {
  Politica: {
    positive: [
      ['governo', 4], ['senato', 4], ['camera', 3], ['presidente', 3], ['ministro', 4], ['parlamento', 4],
      ['decreto', 3], ['elezioni', 4], ['partito', 3], ['premier', 4], ['manifestazione', 3], ['corteo', 3],
      ['25 aprile', 3], ['liberazione', 3], ['sindaco', 3], ['regione', 2]
    ],
    negative: [['serie a', 3], ['camera da letto', 3]]
  },
  Economia: {
    positive: [
      ['pil', 5], ['inflazione', 5], ['spread', 5], ['borsa', 4], ['banca', 4], ['banche', 4], ['mercato', 3],
      ['mercati', 4], ['economia', 5], ['finanza', 4], ['lavoro', 3], ['azienda', 3], ['aziende', 3],
      ['occupazione', 4], ['tassi', 4], ['prezzi', 3], ['bilancio', 3], ['fiscale', 4], ['tasse', 4], ['imposte', 4]
    ],
    negative: [['mercato rionale', 3], ['borsa rubata', 4]]
  },
  Tecnologia: {
    positive: [
      ['intelligenza artificiale', 6], ['artificial intelligence', 6], ['ai', 5], ['ia', 5], ['software', 5],
      ['hardware', 5], ['chip', 5], ['cloud', 4], ['cybersecurity', 5], ['cyber', 4], ['digitale', 4],
      ['startup', 4], ['app', 4], ['robot', 4], ['smartphone', 4], ['semiconduttori', 5]
    ],
    negative: [['aria', 8], ['pistola', 6], ['feriti', 6], ['ferite', 6], ['incidente', 5], ['arresto', 5], ['polizia', 5]]
  },
  Scienza: {
    positive: [
      ['ricerca', 4], ['laboratorio', 4], ['nasa', 5], ['esa', 5], ['astronomia', 5], ['studio scientifico', 5],
      ['scienziati', 5], ['fisica', 4], ['biologia', 4], ['spazio', 4], ['scoperta', 3], ['esperimento', 4]
    ],
    negative: [['studio televisivo', 4], ['studio legale', 4]]
  },
  Ambiente: {
    positive: [
      ['clima', 5], ['cambiamento climatico', 5], ['emissioni', 5], ['co2', 5], ['energia rinnovabile', 5], ['alluvione', 5], ['siccita', 5],
      ['biodiversita', 5], ['ambiente', 5], ['inquinamento', 5], ['meteo estremo', 4], ['green', 3], ['rinnovabili', 5]
    ],
    negative: [['energia del governo', 2]]
  },
  Sport: {
    positive: [
      ['partita', 4], ['campionato', 4], ['serie a', 5], ['champions', 5], ['gol', 5], ['allenatore', 4],
      ['tennis', 5], ['basket', 5], ['formula 1', 5], ['motogp', 5], ['maratona', 5], ['calcio', 5], ['atleta', 4]
    ],
    negative: []
  },
  Cultura: {
    positive: [
      ['mostra', 5], ['romanzo', 5], ['festival letterario', 5], ['museo', 5], ['opera', 4], ['teatro', 5],
      ['biennale', 5], ['arte', 4], ['libro', 4], ['libri', 4], ['scrittore', 4], ['letteratura', 5]
    ],
    negative: [['operazione di polizia', 4]]
  },
  Salute: {
    positive: [
      ['ospedale', 5], ['medico', 4], ['medici', 4], ['farmaco', 5], ['vaccino', 5], ['sanitario', 4],
      ['epidemia', 5], ['diagnosi', 5], ['malattia', 5], ['virus', 4], ['salute', 5], ['terapia', 4]
    ],
    negative: []
  },
  Esteri: {
    positive: [
      ['ucraina', 5], ['russia', 5], ['usa', 4], ['stati uniti', 5], ['nato', 5], ['gaza', 5], ['israele', 5],
      ['cina', 5], ['francia', 4], ['germania', 4], ['diplomazia', 5], ['estero', 4], ['esteri', 5], ['ue', 4]
    ],
    negative: []
  },
  Cronaca: {
    positive: [
      ['incidente', 5], ['arresto', 5], ['arrestato', 5], ['arrestati', 5], ['procura', 5], ['tribunale', 5],
      ['omicidio', 6], ['furto', 5], ['vigili del fuoco', 5], ['ferito', 5], ['feriti', 5], ['ferita', 5],
      ['ferite', 5], ['pistola', 5], ['spari', 6], ['colpi di pistola', 7], ['aggressione', 6], ['polizia', 5],
      ['carabinieri', 5], ['denuncia', 4], ['morto', 5], ['morti', 5], ['violenza', 5], ['processo', 4]
    ],
    negative: [['film', 3], ['serie tv', 3]]
  },
  Spettacolo: {
    positive: [
      ['attore', 5], ['attrice', 5], ['serie tv', 5], ['box office', 5], ['album', 5], ['sanremo', 5],
      ['concerto', 5], ['cinema', 5], ['film', 4], ['tv', 4], ['musica', 4], ['cantante', 4]
    ],
    negative: [['filmato', 4]]
  }
};

const BLOCKED_TOPICS = new Set([
  'copertina',
  'homepage',
  'home page',
  'topnews',
  'top news',
  'rss'
]);

const CANONICAL_TOPIC_SET = new Set(CANONICAL_TOPICS.map((topic) => cleanTopicValue(topic)));

function cleanTopicValue(topic) {
  return String(topic || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsCleanPhrase(text, phrase) {
  const normalizedPhrase = cleanTopicValue(phrase);
  if (!normalizedPhrase) {
    return false;
  }

  if (text === normalizedPhrase) {
    return true;
  }

  return new RegExp(`(^|\\s)${escapeRegex(normalizedPhrase)}(\\s|$)`, 'u').test(text);
}

function topicAliasMatches(cleaned, alias) {
  const normalizedAlias = cleanTopicValue(alias);
  if (!normalizedAlias) {
    return false;
  }

  if (cleaned === normalizedAlias) {
    return true;
  }

  if (normalizedAlias.length <= 3) {
    return containsCleanPhrase(cleaned, normalizedAlias);
  }

  return containsCleanPhrase(cleaned, normalizedAlias) || cleaned.includes(normalizedAlias);
}

function getArticleText(article = {}) {
  return cleanTopicValue([
    article.title,
    article.description,
    article.content
  ].filter(Boolean).join(' '));
}

function scoreRules(text, rules = []) {
  return rules.reduce((result, [phrase, weight]) => {
    if (!containsCleanPhrase(text, phrase)) {
      return result;
    }

    result.score += weight;
    result.evidence.push(phrase);
    return result;
  }, { score: 0, evidence: [] });
}

function classifyTopicsFromText(article = {}, options = {}) {
  const text = getArticleText(article);
  const threshold = Number.isFinite(options.threshold) ? options.threshold : TOPIC_SCORE_THRESHOLD;

  if (!text) {
    return [];
  }

  return Object.entries(TOPIC_RULES)
    .map(([topic, rules]) => {
      const positive = scoreRules(text, rules.positive);
      const negative = scoreRules(text, rules.negative);
      const score = Math.max(0, positive.score - negative.score);

      return {
        topic,
        score,
        confidence: Math.min(0.99, Number((score / 10).toFixed(2))),
        source: 'local',
        evidence: positive.evidence,
        negativeEvidence: negative.evidence,
        reasonCode: score >= threshold ? 'weighted_phrase_match' : 'below_threshold'
      };
    })
    .filter((entry) => entry.score >= threshold)
    .sort((left, right) => right.score - left.score || left.topic.localeCompare(right.topic));
}

function formatTopic(topic) {
  const cleaned = cleanTopicValue(topic);
  if (!isMeaningfulTopic(cleaned) || !CANONICAL_TOPIC_SET.has(cleaned)) {
    return null;
  }

  const canonicalMatch = CANONICAL_TOPICS.find((item) => cleanTopicValue(item) === cleaned);
  if (canonicalMatch) {
    return canonicalMatch;
  }

  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function normalizeTopic(topic) {
  const cleaned = cleanTopicValue(topic);
  if (!isMeaningfulTopic(cleaned)) {
    return null;
  }

  const canonicalMatch = CANONICAL_TOPICS.find((item) => cleanTopicValue(item) === cleaned);
  if (canonicalMatch) {
    return canonicalMatch;
  }

  for (const [canonicalTopic, aliases] of Object.entries(TOPIC_ALIASES)) {
    if (aliases.some((alias) => topicAliasMatches(cleaned, alias))) {
      return canonicalTopic;
    }
  }

  return null;
}

function isCanonicalTopic(topic) {
  const normalized = normalizeTopic(topic);
  return Boolean(normalized && CANONICAL_TOPIC_SET.has(cleanTopicValue(normalized)));
}

function isMeaningfulTopic(topic) {
  const cleaned = cleanTopicValue(topic);

  if (!cleaned || cleaned.length < 2) {
    return false;
  }

  if (/^\d/.test(cleaned)) {
    return false;
  }

  if (BLOCKED_TOPICS.has(cleaned)) {
    return false;
  }

  return true;
}

function removeDuplicates(topics) {
  if (!Array.isArray(topics)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  topics.forEach((topic) => {
    const normalized = normalizeTopic(topic);
    if (!normalized) {
      return;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    result.push(normalized);
  });

  return result;
}

function limitTopics(topics, maxTopics = 3) {
  return removeDuplicates(topics).slice(0, maxTopics);
}

function inferTopicsFromText(article = {}) {
  return classifyTopicsFromText(article).map((entry) => entry.topic);
}

function extractTopics(article = {}, rawTopics = []) {
  const normalizedRawTopics = Array.isArray(rawTopics)
    ? rawTopics.map((topic) => normalizeTopic(topic)).filter(Boolean)
    : [];

  const inferredTopics = inferTopicsFromText(article);
  return limitTopics([...normalizedRawTopics, ...inferredTopics], 4);
}

function extractTopicDetails(article = {}, rawTopics = []) {
  const rawTopicDetails = Array.isArray(rawTopics)
    ? rawTopics
      .map((topic) => normalizeTopic(topic))
      .filter(Boolean)
      .map((topic) => ({
        topic,
        score: TOPIC_SCORE_THRESHOLD,
        confidence: 0.55,
        source: 'rss',
        evidence: [],
        negativeEvidence: [],
        reasonCode: 'rss_topic_alias'
      }))
    : [];
  const localTopicDetails = classifyTopicsFromText(article);
  const seen = new Set();

  return [...rawTopicDetails, ...localTopicDetails]
    .filter((entry) => {
      const key = entry.topic.toLowerCase();
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .slice(0, 4);
}

module.exports = {
  CANONICAL_TOPICS,
  cleanTopicValue,
  isMeaningfulTopic,
  formatTopic,
  normalizeTopic,
  isCanonicalTopic,
  removeDuplicates,
  limitTopics,
  classifyTopicsFromText,
  inferTopicsFromText,
  extractTopics,
  extractTopicDetails
};
