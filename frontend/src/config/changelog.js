export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.4',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧭 New accounts now start with a simple source picker, so each feed begins with only the built-in RSS sources the user wants active.',
      '🔖 Source icons now travel with built-in and custom RSS sources, making the source picker easier to scan and ready for reuse elsewhere.',
      '🏷️ Source chips in filters and settings now show provider icons beside their names for quicker recognition.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧭 I nuovi account partono con una scelta semplice delle fonti, cosi il feed include solo gli RSS integrati che l\'utente vuole attivare.',
      '🔖 Le icone delle fonti ora accompagnano gli RSS integrati e personalizzati, rendendo la scelta piu immediata e riutilizzabile altrove.',
      '🏷️ I chip delle fonti nei filtri e nelle impostazioni mostrano l\'icona del provider accanto al nome per riconoscerle piu rapidamente.',
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
