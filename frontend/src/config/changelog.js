export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.14',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '📡 Made custom RSS feeds safer with exact URL isolation, per-account limits, and bounded network work.',
      '🔖 Preserved distinct same-title stories and saved articles when sources change.',
      '🛡️ Hardened account recovery, API-token limits, private browser requests, and service readiness.',
      '🔄 Added retryable session loading and limited feedback to configured deployments.',
      '🤖 Updated the default AI models for classification, story grouping, summaries, and podcast scripts.',
      '👆 Simplified mobile cards with titles above adaptive cover images, a white feed, compact actions, and swipe-safe single-tap Reader opening.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '📡 Resi piu sicuri i feed RSS personalizzati con URL esatti, limiti per account e lavoro di rete controllato.',
      '🔖 Mantenute separate le storie con lo stesso titolo e conservati gli articoli salvati quando cambiano le fonti.',
      '🛡️ Rafforzati recupero account, limiti token API, richieste browser private e controlli di disponibilita.',
      '🔄 Aggiunto il nuovo tentativo di caricamento sessione e mostrato il feedback solo quando la consegna e configurata.',
      '🤖 Aggiornati i modelli AI predefiniti per classificazione, raggruppamento delle storie, riepiloghi e script podcast.',
      '👆 Semplificate le schede mobile con titoli sopra immagini di copertina adattive, sfondo bianco, azioni compatte e apertura Reader con un tocco che ignora gli scorrimenti.'
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
