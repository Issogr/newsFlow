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

const KEYWORD_TOPICS = {
  Politica: ['governo', 'senato', 'camera', 'presidente', 'ministro', 'parlamento', 'decreto', 'election', 'minister', 'premier'],
  Economia: ['pil', 'inflazione', 'spread', 'borsa', 'bank', 'banca', 'mercato', 'economy', 'finanza', 'lavoro'],
  Tecnologia: ['software', 'hardware', 'chip', 'cloud', 'cyber', 'digitale', 'artificial intelligence', 'intelligenza artificiale', 'app'],
  Scienza: ['ricerca', 'laboratorio', 'nasa', 'esa', 'astronomia', 'scientist', 'studio clinico'],
  Ambiente: ['clima', 'emissioni', 'carbon', 'energia rinnovabile', 'alluvione', 'siccita', 'biodiversita'],
  Sport: ['partita', 'campionato', 'serie a', 'champions', 'gol', 'allenatore', 'tennis', 'gp', 'maratona'],
  Cultura: ['mostra', 'romanzo', 'festival letterario', 'museo', 'opera', 'teatro', 'biennale'],
  Salute: ['ospedale', 'medico', 'medici', 'farmaco', 'vaccino', 'sanitario', 'epidemia', 'diagnosi'],
  Esteri: ['ucraina', 'russia', 'usa', 'europa', 'nato', 'gaza', 'israele', 'cina', 'francia', 'germania'],
  Cronaca: ['incidente', 'arresto', 'procura', 'tribunale', 'omicidio', 'furto', 'vigili del fuoco'],
  Spettacolo: ['attore', 'attrice', 'serie tv', 'box office', 'album', 'sanremo', 'concerto']
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
    if (aliases.some((alias) => cleaned === cleanTopicValue(alias) || cleaned.includes(cleanTopicValue(alias)))) {
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
  const text = cleanTopicValue([
    article.title,
    article.description,
    article.content
  ].filter(Boolean).join(' '));

  if (!text) {
    return [];
  }

  const scoredTopics = Object.entries(KEYWORD_TOPICS)
    .map(([topic, keywords]) => {
      const score = keywords.reduce((total, keyword) => {
        return total + (text.includes(cleanTopicValue(keyword)) ? 1 : 0);
      }, 0);

      return { topic, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.topic.localeCompare(right.topic));

  return scoredTopics.map((entry) => entry.topic);
}

function extractTopics(article = {}, rawTopics = []) {
  const normalizedRawTopics = Array.isArray(rawTopics)
    ? rawTopics.map((topic) => normalizeTopic(topic)).filter(Boolean)
    : [];

  const inferredTopics = inferTopicsFromText(article);
  return limitTopics([...normalizedRawTopics, ...inferredTopics], 4);
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
  inferTopicsFromText,
  extractTopics
};
