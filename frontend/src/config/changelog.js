export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.11',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧹 Article retention now follows the app-wide server setting only, so the settings panel no longer offers a per-user retention field.',
      '⏱️ The latest-hours quick filter and its settings field were removed because the feed is already ordered by age and paginated.',
      '📱 News cards now use a colorful social-feed layout with compact source headers, 16:9 imagery, image-overlay topics, compact header actions, and an edge-to-edge mobile feed.',
      '✨ Card-shaped loading placeholders, matching floating navigation across desktop and mobile, and reduced-motion-aware feed animations make navigation feel smoother.',
      '⬆️ On mobile, the bottom navbar now uses a liquid-style expansion from a separate back-to-top button while scrolling up and reclaims the space at the top.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧹 La retention degli articoli ora segue solo l\'impostazione server globale, quindi nelle impostazioni non c\'e piu un campo per utente.',
      '⏱️ Il filtro rapido sulle ultime ore e il relativo campo impostazioni sono stati rimossi perche il feed e gia ordinato per data e paginato.',
      '📱 Le schede delle notizie ora hanno un layout social piu vivace, con fonti compatte, immagini 16:9, topic sovrapposti alle immagini, azioni compatte nella testata e un feed mobile da bordo a bordo.',
      '✨ Placeholder di caricamento a forma di scheda, barre di navigazione fluttuanti coordinate su desktop e mobile e animazioni compatibili con movimento ridotto rendono la navigazione piu fluida.',
      '⬆️ Su mobile, la barra inferiore ora si espande con un effetto liquido dal pulsante separato per tornare in cima e ne recupera lo spazio quando si raggiunge la parte alta.'
    ]
  }
};

export function getCurrentChangelog(locale = 'en') {
  const localizedEntry = CURRENT_CHANGELOG_ENTRY[locale] || CURRENT_CHANGELOG_ENTRY.en;

  return {
    version: CURRENT_CHANGELOG_ENTRY.version,
    ...localizedEntry
  };
}
