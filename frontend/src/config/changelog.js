export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.4',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🔐 You can now sign in with Clerk alongside the existing local username and password flow.',
      '🔗 Clerk-only accounts can now be unified with an existing local account after re-entering the local login, keeping the original settings, sources, and saved preferences.',
      '🛡️ Clerk sign-in still lands on the same protected News Flow session path, so the app keeps the existing BFF and backend security boundary.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🔐 Ora puoi accedere con Clerk senza rinunciare al flusso locale con username e password gia esistente.',
      '🔗 Gli account creati solo con Clerk possono ora essere unificati con un account locale esistente dopo aver reinserito il login locale, mantenendo impostazioni, fonti e preferenze salvate.',
      '🛡️ L\'accesso con Clerk continua comunque a passare dallo stesso percorso di sessione protetta di News Flow, cosi il confine di sicurezza tra BFF e backend resta invariato.',
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
