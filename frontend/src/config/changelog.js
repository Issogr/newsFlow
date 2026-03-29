export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.6.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🧼 Manual refresh is simple again: the button is back to being just a refresh button, without extra “new articles waiting” hints.',
      '📌 Search and filters now feel more connected, with a smoother dropdown that opens as a natural extension of the top bubble and can scroll on its own when needed.',
      '📱 Card actions are now more consistent across desktop and mobile, with compact Reader and Share buttons and a clearer primary Open action.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🧼 Il refresh manuale e di nuovo semplice: il pulsante torna a essere solo un refresh, senza altri avvisi su nuove notizie in attesa.',
      '📌 Ricerca e filtri ora sembrano piu uniti, con un dropdown piu fluido che si apre come continuazione naturale della barra in alto e puo scorrere da solo quando serve.',
      '📱 Le azioni delle card sono ora piu coerenti tra desktop e mobile, con pulsanti Reader e Share compatti e un Apri articolo piu chiaro come azione principale.',
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
