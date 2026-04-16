export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.10.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '⏳ Signed-in sessions now stay more stable during normal use.',
      '🚪 If a session expires, the app now returns to sign-in right away instead of staying stuck in a broken logged-in state.',
      '📄 Privacy and cookie pages were updated to match the current session behavior.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '⏳ Le sessioni restano piu stabili durante l\'uso normale dell\'app.',
      '🚪 Se una sessione scade, l\'app torna subito alla schermata di accesso invece di restare in uno stato loggato non funzionante.',
      '📄 Privacy Policy e Cookie Policy sono state aggiornate per riflettere il comportamento attuale delle sessioni.',
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
