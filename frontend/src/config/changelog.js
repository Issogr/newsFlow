export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.5',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🖼️ News cards can now show article images more often, even when some publishers leave the picture out of the feed itself.',
      '⚡ To keep refreshes fast and avoid slowing down the whole app, this extra image recovery is used only for a small number of recent articles instead of every story.',
      '📰 If a publisher already provides a valid image in the feed, News Flow still uses it right away as before.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🖼️ Le news card ora riescono a mostrare piu spesso l\'immagine dell\'articolo, anche quando alcuni giornali non la includono direttamente nel feed.',
      '⚡ Per mantenere gli aggiornamenti veloci e non rallentare tutta l\'app, questo recupero extra delle immagini viene usato solo su un piccolo numero di articoli recenti e non su tutte le notizie.',
      '📰 Se una fonte fornisce gia un\'immagine valida nel feed, News Flow continua a usarla subito come sempre.'
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
