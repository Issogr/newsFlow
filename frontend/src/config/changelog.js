export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.13.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🛠️ The app styling foundation has been refreshed under the hood, preserving the current look while making future interface updates safer and smoother.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🛠️ La base grafica dell app e stata aggiornata sotto il cofano, mantenendo l aspetto attuale e rendendo i futuri ritocchi all interfaccia piu sicuri e fluidi.',
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
