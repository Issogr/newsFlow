export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.4',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🕒 Articles with a wrong future date are now corrected automatically, so a typo from a source can no longer leave one story stuck at the top.',
      '🧹 Existing stories already saved with a future date are cleaned up automatically during refreshes, so the feed returns to the right order without manual fixes.',
      '🔒 Opening articles is now safer and more reliable, including better handling of unusual or broken source links.',
      '🔄 Live updates now respect your source exclusions more consistently, so hidden sources stay out of your feed.',
      '⚙️ Personal settings and custom source changes now behave more predictably, especially while editing and saving your setup.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🕒 Gli articoli con una data impostata per errore nel futuro vengono ora corretti automaticamente, cosi una svista della fonte non puo piu lasciare una notizia bloccata in cima.',
      '🧹 Le notizie gia salvate con una data futura vengono sistemate automaticamente durante gli aggiornamenti, cosi il feed torna nel giusto ordine senza interventi manuali.',
      '🔒 L\'apertura degli articoli e ora piu sicura e affidabile, anche quando una fonte usa link insoliti o difettosi.',
      '🔄 Gli aggiornamenti live rispettano meglio le fonti escluse, cosi le fonti nascoste restano fuori dal tuo feed.',
      '⚙️ Le impostazioni personali e le modifiche alle fonti custom ora si comportano in modo piu prevedibile, soprattutto durante modifica e salvataggio.'
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
