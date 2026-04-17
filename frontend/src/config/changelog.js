export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.10.4',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔔 New releases now appear as a small update pill at the top of the app instead of opening the changelog immediately after login.',
      '🧭 The update pill can open the full changelog on demand, can be closed manually, and fades away automatically with a visible countdown bar.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔔 I nuovi rilasci ora compaiono come una piccola pill in alto nell\'app invece di aprire subito il changelog dopo il login.',
      '🧭 La pill di aggiornamento puo aprire il changelog completo su richiesta, si puo chiudere a mano e sparisce da sola con una barra di avanzamento visibile.',
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
