export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.3.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🌍 Fanpage was removed from the built-in RSS catalog because it was creating feed problems.',
      '🖼️ Animated GIFs are no longer used as news card cover images.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🌍 Fanpage e stata rimossa dal catalogo RSS integrato perche creava problemi nel feed.',
      '🖼️ Le GIF animate non vengono piu usate come immagini di copertina delle notizie.',
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
