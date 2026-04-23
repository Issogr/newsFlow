export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.11',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📰 News card titles now use the full available width for easier scanning.',
      '🏷 Source labels moved onto the article image to free up card space.',
      '🧹 Removed topic icons from cards for a calmer, less cluttered layout.',
      '📱 Mobile now has a floating bottom navigation for sources, topics, time filters, and search.',
      '✨ The top bar now stays visible and gently shrinks while scrolling.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📰 I titoli delle card notizia usano ora tutta la larghezza disponibile per una lettura piu comoda.',
      '🏷 Le etichette delle fonti sono state spostate sull\'immagine dell\'articolo per liberare spazio nella card.',
      '🧹 Rimosse le icone dei topic dalle card per un layout piu pulito e ordinato.',
      '📱 Su mobile c\'e una nuova navigazione flottante in basso per fonti, topic, filtro orario e ricerca.',
      '✨ La barra superiore resta visibile e si compatta leggermente durante lo scroll.',
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
