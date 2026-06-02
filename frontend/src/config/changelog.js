export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🗂️ Thematic summaries now follow the same morning and evening schedule as podcasts, no longer generate unused titles, and use simple slot labels instead of exact time ranges.',
      '🧽 Podcast briefings now run for morning and evening windows, keep both latest players available, and hide script text from the player panel.',
      '🎧 Podcast script and audio generation can now be limited by enabled language, defaults to English audio, and shows which audio language is available when it differs from the app language.',
      '🕒 News cards now show the article published date and time in a compact pill.',
      '🛡️ Background refreshes, source setup, public API counters, and the BFF proxy are now more resilient under concurrent use.',
      '🔒 Anonymous and token-authenticated public API access are now separate opt-in server settings, and token controls appear only when token access is enabled.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🗂️ Le sintesi tematiche ora seguono la stessa programmazione mattina e sera dei podcast, non generano piu titoli inutilizzati e usano etichette semplici invece di fasce orarie precise.',
      '🧽 I briefing podcast ora seguono le finestre mattina e sera, tengono disponibili entrambi i player piu recenti e nascondono il testo nel pannello audio.',
      '🎧 Script e audio dei podcast possono ora essere limitati per lingua abilitata, partono dall\'audio inglese e mostrano quale lingua audio e disponibile quando differisce dalla lingua dell\'app.',
      '🕒 Le card delle notizie ora mostrano data e ora di pubblicazione in una pill compatta.',
      '🛡️ Refresh in background, scelta fonti, contatori API pubbliche e proxy BFF sono piu solidi con utilizzo concorrente.',
      '🔒 Accesso API pubblico anonimo e con token sono ora opzioni server separate, e i controlli token compaiono solo quando l\'accesso con token e attivo.'
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
