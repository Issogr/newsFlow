export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.10.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔐 Signed-in sessions now survive browser close and reopen more reliably.',
      '⏳ Sessions no longer depend on temporary in-memory BFF state, so they stay more stable during normal use.',
      '🚪 If a session still becomes invalid, the app returns to sign-in right away instead of staying stuck in a broken logged-in state.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔐 Le sessioni ora sopravvivono in modo piu affidabile alla chiusura e riapertura del browser.',
      '⏳ Le sessioni non dipendono piu da stato temporaneo in memoria nel BFF, quindi restano piu stabili durante l\'uso normale.',
      '🚪 Se una sessione diventa comunque non valida, l\'app torna subito alla schermata di accesso invece di restare in uno stato loggato non funzionante.',
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
