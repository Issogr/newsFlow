export const SUPPORTED_LOCALES = ['en', 'it'];

export const translations = {
  en: {
    pageTitle: 'News Flow',
    pageSubtitle: 'News collection with scheduled updates, server-side filters, and persistent tagging.',
    liveActive: 'Live active',
    liveOffline: 'Live offline',
    refresh: 'Refresh',
    searchPlaceholder: 'Search by title, content, or topic...',
    visibleGroups: ({ count }) => `${count} visible groups`,
    totalGroups: ({ count }) => `${count} groups`,
    updatedAt: ({ time }) => `Updated ${time}`,
    filtersTitle: 'Filters',
    filtersSubtitle: 'Source, topic, and time window.',
    latestHours: ({ hours }) => `Last ${hours} hours`,
    resetFilters: 'Reset filters',
    sources: 'Sources',
    topics: 'Topics',
    noNewsTitle: 'No news found',
    noNewsText: 'Try widening the filters or refresh the feed.',
    loadingMore: 'Loading...',
    loadMore: 'Load more groups',
    noMoreResults: 'You reached the end of the available results.',
    localeLabel: 'Language',
    localeEnglish: 'English',
    localeItalian: 'Italiano',
    settings: 'Settings',
    saveSettings: 'Save settings',
    saving: 'Saving...',
    logout: 'Logout',
    account: 'Account',
    preferences: 'Preferences',
    customSources: 'Custom sources',
    noCustomSources: 'No custom sources yet.',
    sourceName: 'Source name',
    rssUrl: 'RSS URL',
    addSource: 'Add source',
    remove: 'Remove',
    hiddenSources: 'Hidden sources',
    hiddenSourcesHelp: 'Hidden sources are excluded from your feed by default.',
    defaultLanguageSetting: 'Default language',
    useBrowserLanguage: 'Use browser language',
    articleRetention: 'Article retention (hours)',
    quickFilterHours: 'Quick filter hours',
    authTitle: 'Personalize your news space',
    authSubtitle: 'Create a user or sign in to save your sources, defaults, and reading preferences.',
    signIn: 'Sign in',
    createAccount: 'Create account',
    username: 'Username',
    passwordOptional: 'Password (optional)',
    passwordHelp: 'Passwords are optional for now. You can leave this field empty.',
    loginAction: 'Login',
    registerAction: 'Create user',
    addSourceHelp: 'RSS feeds added here are personal and do not affect other users.',
    welcomeUser: ({ username }) => `Hello ${username}`,
    notifications: 'Notifications',
    closeNotifications: 'Close notifications',
    noNotifications: 'No notifications',
    refreshNewArticles: ({ count }) => `Load ${count} new ${count === 1 ? 'article' : 'articles'}`,
    newArticles: ({ count }) => `${count} ${count === 1 ? 'new article' : 'new articles'}`,
    clickToRefresh: 'Click to refresh',
    removeNotification: 'Remove notification',
    clearAllNotifications: 'Clear all notifications',
    notificationCount: ({ count }) => `${count} notifications`,
    errorTitle: 'Unable to load the news',
    unknownError: 'An unknown error occurred.',
    networkError: 'Unable to reach the server. Check your internet connection.',
    error400: 'The request is not valid.',
    error401: 'You are not authorized to perform this action.',
    error403: 'Access to this resource is denied.',
    error404: 'Resource not found. The service may have been moved or removed.',
    error429: 'Too many requests. Please wait a moment and try again.',
    error503: 'The service is currently unavailable. Please try again later.',
    error500: 'An internal server error occurred. The team has been notified.',
    unknownStatusError: ({ status, statusText }) => `Error ${status}: ${statusText || 'Unknown error'}`,
    genericError: 'An unexpected error occurred.',
    codeLabel: ({ code }) => `Code: ${code}`,
    retry: 'Retry',
    retryAria: 'Retry loading data',
    persistentErrorHelp: 'If the issue persists, check the service status or contact support.',
    singleSource: 'Single source',
    sourceCount: ({ count }) => `${count} sources`,
    noExcerpt: 'No excerpt available for this article.',
    openOriginalSource: 'Open original source',
    readerMode: 'Reader mode',
    closeReader: 'Close reader',
    loadingReader: 'Loading reader view...',
    readerUnavailable: 'Reader mode is not available for this article.',
    readerFallback: 'Showing fallback text extracted from the feed.',
    readTime: ({ minutes }) => `${minutes} min read`,
    cleanReadingView: 'Clean reading view',
    sourceVersions: 'Source versions',
    refreshReader: 'Refresh reader copy',
    newsLanguage: ({ language }) => `News language: ${language}`,
    wsConnected: 'Real-time connection active',
    wsDisconnected: 'Real-time connection lost, reconnecting...',
    wsReconnectFailed: 'Unable to restore the real-time connection',
    wsNewGroups: ({ count }) => `${count} new news groups available`
  },
  it: {
    pageTitle: 'News Flow',
    pageSubtitle: 'Raccolta notizie con aggiornamenti schedulati, filtri server-side e tagging persistente.',
    liveActive: 'Live attivo',
    liveOffline: 'Live offline',
    refresh: 'Aggiorna',
    searchPlaceholder: 'Cerca su titolo, contenuto o topic...',
    visibleGroups: ({ count }) => `${count} gruppi visibili`,
    totalGroups: ({ count }) => `${count} gruppi`,
    updatedAt: ({ time }) => `Aggiornato ${time}`,
    filtersTitle: 'Filtri',
    filtersSubtitle: 'Fonte, topic e finestra temporale.',
    latestHours: ({ hours }) => `Ultime ${hours} ore`,
    resetFilters: 'Reset filtri',
    sources: 'Fonti',
    topics: 'Topic',
    noNewsTitle: 'Nessuna notizia trovata',
    noNewsText: 'Prova ad allargare i filtri oppure aggiorna il feed.',
    loadingMore: 'Caricamento...',
    loadMore: 'Carica altri gruppi',
    noMoreResults: 'Hai raggiunto la fine dei risultati disponibili.',
    localeLabel: 'Lingua',
    localeEnglish: 'English',
    localeItalian: 'Italiano',
    settings: 'Impostazioni',
    saveSettings: 'Salva impostazioni',
    saving: 'Salvataggio...',
    logout: 'Esci',
    account: 'Account',
    preferences: 'Preferenze',
    customSources: 'Fonti personali',
    noCustomSources: 'Nessuna fonte personale per ora.',
    sourceName: 'Nome fonte',
    rssUrl: 'URL RSS',
    addSource: 'Aggiungi fonte',
    remove: 'Rimuovi',
    hiddenSources: 'Fonti nascoste',
    hiddenSourcesHelp: 'Le fonti nascoste vengono escluse dal tuo feed in modo predefinito.',
    defaultLanguageSetting: 'Lingua predefinita',
    useBrowserLanguage: 'Usa lingua browser',
    articleRetention: 'Retention articoli (ore)',
    quickFilterHours: 'Ore filtro rapido',
    authTitle: 'Personalizza il tuo spazio notizie',
    authSubtitle: 'Crea un utente o accedi per salvare fonti, preferenze e configurazione personale.',
    signIn: 'Accedi',
    createAccount: 'Crea account',
    username: 'Username',
    passwordOptional: 'Password (opzionale)',
    passwordHelp: 'Per ora la password è opzionale. Puoi lasciare il campo vuoto.',
    loginAction: 'Accedi',
    registerAction: 'Crea utente',
    addSourceHelp: 'Le fonti RSS aggiunte qui sono personali e non influenzano gli altri utenti.',
    welcomeUser: ({ username }) => `Ciao ${username}`,
    notifications: 'Notifiche',
    closeNotifications: 'Chiudi notifiche',
    noNotifications: 'Nessuna notifica',
    refreshNewArticles: ({ count }) => `Carica ${count} nuovi ${count === 1 ? 'articolo' : 'articoli'}`,
    newArticles: ({ count }) => `${count} ${count === 1 ? 'nuovo articolo' : 'nuovi articoli'}`,
    clickToRefresh: 'Clicca per aggiornare',
    removeNotification: 'Elimina notifica',
    clearAllNotifications: 'Elimina tutte le notifiche',
    notificationCount: ({ count }) => `${count} notifiche`,
    errorTitle: 'Impossibile caricare le notizie',
    unknownError: 'Si è verificato un errore sconosciuto.',
    networkError: 'Impossibile connettersi al server. Verifica la tua connessione internet.',
    error400: 'La richiesta non è valida.',
    error401: 'Non sei autorizzato a eseguire questa azione.',
    error403: 'Accesso negato a questa risorsa.',
    error404: 'Risorsa non trovata. Il servizio potrebbe essere stato spostato o rimosso.',
    error429: 'Troppe richieste. Attendi qualche momento prima di riprovare.',
    error503: 'Il servizio non è al momento disponibile. Riprova più tardi.',
    error500: 'Si è verificato un errore interno del server. Il team è stato notificato.',
    unknownStatusError: ({ status, statusText }) => `Errore ${status}: ${statusText || 'Errore sconosciuto'}`,
    genericError: 'Si è verificato un errore imprevisto.',
    codeLabel: ({ code }) => `Codice: ${code}`,
    retry: 'Riprova',
    retryAria: 'Riprova a caricare i dati',
    persistentErrorHelp: 'Se il problema persiste, controlla lo stato del servizio o contatta l\'assistenza.',
    singleSource: 'Fonte singola',
    sourceCount: ({ count }) => `${count} fonti`,
    noExcerpt: 'Nessun estratto disponibile per questo articolo.',
    openOriginalSource: 'Apri la fonte originale',
    readerMode: 'Modalita lettura',
    closeReader: 'Chiudi lettura',
    loadingReader: 'Caricamento modalita lettura...',
    readerUnavailable: 'La modalita lettura non e disponibile per questo articolo.',
    readerFallback: 'Mostro il testo di fallback estratto dal feed.',
    readTime: ({ minutes }) => `${minutes} min di lettura`,
    cleanReadingView: 'Vista lettura pulita',
    sourceVersions: 'Versioni fonte',
    refreshReader: 'Aggiorna copia lettura',
    newsLanguage: ({ language }) => `Lingua notizia: ${language}`,
    wsConnected: 'Connessione real-time attiva',
    wsDisconnected: 'Connessione real-time persa, riconnessione in corso...',
    wsReconnectFailed: 'Impossibile ristabilire la connessione real-time',
    wsNewGroups: ({ count }) => `${count} nuovi gruppi di notizie disponibili`
  }
};

export function detectBrowserLocale() {
  const preferredLanguages = Array.isArray(navigator.languages) && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language || 'en'];

  const match = preferredLanguages
    .map((value) => String(value || '').toLowerCase())
    .find((value) => value.startsWith('it') || value.startsWith('en'));

  return match?.startsWith('it') ? 'it' : 'en';
}

export function createTranslator(locale) {
  const catalog = translations[locale] || translations.en;

  return (key, params = {}) => {
    const entry = catalog[key] || translations.en[key] || key;
    return typeof entry === 'function' ? entry(params) : entry;
  };
}

export function getDateLocale(locale) {
  return locale === 'it' ? 'it-IT' : 'en-US';
}

const languageMeta = {
  it: { flag: 'IT', emoji: '🇮🇹', labels: { en: 'Italian', it: 'Italiano' } },
  en: { flag: 'EN', emoji: '🇬🇧', labels: { en: 'English', it: 'Inglese' } },
  fr: { flag: 'FR', emoji: '🇫🇷', labels: { en: 'French', it: 'Francese' } },
  de: { flag: 'DE', emoji: '🇩🇪', labels: { en: 'German', it: 'Tedesco' } },
  es: { flag: 'ES', emoji: '🇪🇸', labels: { en: 'Spanish', it: 'Spagnolo' } }
};

export function getLanguageMeta(language, locale = 'en') {
  const normalized = String(language || '').toLowerCase().slice(0, 2);
  const entry = languageMeta[normalized];

  if (!entry) {
    return {
      flag: normalized ? normalized.toUpperCase() : '??',
      emoji: '🌐',
      label: normalized ? normalized.toUpperCase() : 'Unknown'
    };
  }

  return {
    flag: entry.flag,
    emoji: entry.emoji,
    label: entry.labels[locale] || entry.labels.en
  };
}
