export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.10.1',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '⏳ Active signed-in sessions now renew their lifetime while you keep using the app, so you are less likely to hit an unexpected expiry in the middle of a session.',
      '🚪 If an authenticated session does become invalid, the app now returns to the sign-in screen immediately instead of staying visibly logged in while actions fail in the background.',
      '🍪 The default authenticated session lifetime stays at 30 days, while active use now renews the session in the background so normal usage is less likely to hit an unexpected expiry.',
      '📄 The privacy and cookie policy pages were updated as well, so the documented 30-day session-retention window matches the current app behavior.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '⏳ Le sessioni attive ora rinnovano la loro durata mentre continui a usare l\'app, cosi e molto meno probabile incontrare una scadenza improvvisa nel mezzo dell\'uso.',
      '🚪 Se una sessione autenticata diventa comunque non valida, l\'app torna subito alla schermata di accesso invece di restare apparentemente loggata mentre le azioni falliscono dietro le quinte.',
      '🍪 La durata predefinita della sessione autenticata resta di 30 giorni, ma l\'uso attivo ora rinnova la sessione in background cosi l\'uso normale difficilmente incontra una scadenza inattesa.',
      '📄 Anche Privacy Policy e Cookie Policy sono state aggiornate, cosi la finestra di retention documentata di 30 giorni corrisponde al comportamento attuale dell\'app.',
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
