export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.15',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🕘 Browse current and previous thematic AI summaries from the summary panel; empty versions stay hidden with a disabled chip.',
      '🛡️ Kept the last successful AI summaries visible during temporary generation or refresh failures and refreshed them after reconnecting.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🕘 Consulta le sintesi tematiche IA attuale e precedente dal pannello; le versioni vuote restano nascoste con il chip disabilitato.',
      '🛡️ Le ultime sintesi IA riuscite restano visibili durante errori temporanei di generazione o aggiornamento e vengono aggiornate dopo la riconnessione.'
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
