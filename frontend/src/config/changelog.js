export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.3.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🧭 New accounts now start with a simple source picker, so each feed begins with only the built-in RSS sources the user wants active.',
      '🔖 Source icons now travel with built-in and custom RSS sources, making the source picker easier to scan and ready for reuse elsewhere.',
      '🏷️ Source chips in filters, settings, and news cards now show provider icons for quicker recognition.',
      '📰 News cards now use one social-style layout that keeps images optional while preserving sources, topics, sharing, reader mode, and original links.',
      '🌍 Built-in RSS sources now include Il Post, Open, Il Fatto Quotidiano, Fanpage, Wired Italia, BBC News, The Verge, and The Guardian; everyone will reselect sources from an initially disabled catalog.',
      '🔧 A few under-the-hood improvements keep the feed tidier and the app humming along more smoothly.',
      '🧹 Some behind-the-scenes cleanup swept away a few cobwebs, so News Flow can spend more time flowing and less time tripping over itself.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🧭 I nuovi account partono con una scelta semplice delle fonti, cosi il feed include solo gli RSS integrati che l\'utente vuole attivare.',
      '🔖 Le icone delle fonti ora accompagnano gli RSS integrati e personalizzati, rendendo la scelta piu immediata e riutilizzabile altrove.',
      '🏷️ I chip delle fonti nei filtri, nelle impostazioni e nelle card mostrano l\'icona del provider per riconoscerle piu rapidamente.',
      '📰 Le card delle notizie ora usano un unico layout in stile social che mantiene immagini opzionali, fonti, topic, condivisione, modalita lettura e link originali.',
      '🌍 Le fonti RSS integrate ora includono Il Post, Open, Il Fatto Quotidiano, Fanpage, Wired Italia, BBC News, The Verge e The Guardian; tutti riselezioneranno le fonti partendo da un catalogo inizialmente disattivato.',
      '🔧 Alcuni miglioramenti sotto il cofano tengono il feed piu ordinato e l\'app piu fluida.',
      '🧹 Un po\' di pulizia dietro le quinte ha tolto qualche ragnatela, cosi News Flow puo scorrere meglio e inciampare meno.',
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
