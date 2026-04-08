export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.9',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🎛️ In reader mode, the text-size control now sits next to Share on the left side of the top bar, so the header actions feel more grouped and easier to use.',
      '👆 On news cards, you can now open reader mode faster with a double click on desktop or a double tap on mobile directly on the image or title.',
      '⏱️ Scheduled news checks are now slower by default, moving from 5 minutes to 15 minutes to stay fresh without being too aggressive with upstream sources.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🎛️ In modalita lettura, il controllo della dimensione del testo ora sta accanto a Share sul lato sinistro della barra in alto, cosi le azioni del reader risultano piu raccolte e comode da usare.',
      '👆 Nelle news card ora puoi aprire piu in fretta la modalita lettura con un doppio click su desktop o un doppio tap su mobile direttamente su immagine o titolo.',
      '⏱️ I controlli automatici delle notizie ora sono piu lenti di default: si passa da 5 minuti a 15 minuti per restare aggiornati senza essere troppo aggressivi verso le fonti.',
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
