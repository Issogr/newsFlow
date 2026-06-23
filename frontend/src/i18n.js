import en from './locales/en';
import it from './locales/it';

const SUPPORTED_LOCALES = ['en', 'it'];
const translations = { en, it };

export const LOCALE_STORAGE_KEY = 'newsflow-locale';

function detectBrowserLocale() {
  const preferredLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || 'en'];

  const match = preferredLanguages
    .map((value) => String(value || '').toLowerCase())
    .find((value) => value.startsWith('it') || value.startsWith('en'));

  return match?.startsWith('it') ? 'it' : 'en';
}

function isSupportedLocale(locale) {
  return SUPPORTED_LOCALES.includes(locale);
}

function readStoredLocale() {
  try {
    const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(storedLocale) ? storedLocale : '';
  } catch {
    return '';
  }
}

export function resolvePreferredLocale(preferredLocale, storedLocale = readStoredLocale()) {
  if (isSupportedLocale(preferredLocale)) {
    return preferredLocale;
  }

  if (isSupportedLocale(storedLocale)) {
    return storedLocale;
  }

  return detectBrowserLocale();
}

export function createTranslator(locale) {
  const catalog = translations[locale] || translations.en;

  return (key, params = {}) => {
    const entry = catalog[key] || translations.en[key] || key;
    return typeof entry === 'function' ? entry(params) : entry;
  };
}

const topicTranslations = {
  politica: { en: 'Politics', it: 'Politica' },
  politics: { en: 'Politics', it: 'Politica' },
  economia: { en: 'Economy', it: 'Economia' },
  economy: { en: 'Economy', it: 'Economia' },
  mercati: { en: 'Markets', it: 'Mercati' },
  markets: { en: 'Markets', it: 'Mercati' },
  tecnologia: { en: 'Technology', it: 'Tecnologia' },
  technology: { en: 'Technology', it: 'Tecnologia' },
  tech: { en: 'Technology', it: 'Tecnologia' },
  scienza: { en: 'Science', it: 'Scienza' },
  science: { en: 'Science', it: 'Scienza' },
  cronaca: { en: 'Crime & incidents', it: 'Cronaca' },
  esteri: { en: 'World', it: 'Esteri' },
  world: { en: 'World', it: 'Esteri' },
  international: { en: 'World', it: 'Esteri' },
  salute: { en: 'Health', it: 'Salute' },
  health: { en: 'Health', it: 'Salute' },
  sport: { en: 'Sport', it: 'Sport' },
  sports: { en: 'Sport', it: 'Sport' },
  cultura: { en: 'Culture', it: 'Cultura' },
  culture: { en: 'Culture', it: 'Cultura' },
  spettacolo: { en: 'Entertainment', it: 'Spettacolo' },
  entertainment: { en: 'Entertainment', it: 'Spettacolo' },
  ambiente: { en: 'Environment', it: 'Ambiente' },
  environment: { en: 'Environment', it: 'Ambiente' },
  clima: { en: 'Climate', it: 'Clima' },
  climate: { en: 'Climate', it: 'Clima' },
  sicurezza: { en: 'Security', it: 'Sicurezza' },
  security: { en: 'Security', it: 'Sicurezza' }
};

export function getLocalizedTopic(topic, locale = 'en') {
  const normalized = String(topic || '').trim().toLowerCase();
  const translation = topicTranslations[normalized];

  if (translation) {
    return translation[locale] || translation.en;
  }

  return topic;
}
