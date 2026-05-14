export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.3.3',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🌍 Fanpage was removed from the built-in RSS catalog because it was creating feed problems.',
      '🖼️ Animated GIFs are no longer used as news card cover images.',
      '📰 Custom RSS sources can again load cover images from article pages when the feed omits image metadata.',
      '📱 Adding custom RSS sources is more reliable on mobile because new feeds are saved before their first refresh runs in the background.',
      '🛠️ Deleting users from the admin dashboard now updates the list immediately after a successful delete.',
      '🔄 Manual refresh now uses a short cooldown and shared source freshness guard to keep news timely without overloading RSS providers.',
      '⚡ Feed pagination is faster and more stable on large feeds, especially when many stories share the same publication time.',
      '🧭 Slow RSS sources no longer block unrelated user refreshes, and custom feed validation now fails faster when a provider does not respond.',
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🌍 Fanpage e stata rimossa dal catalogo RSS integrato perche creava problemi nel feed.',
      '🖼️ Le GIF animate non vengono piu usate come immagini di copertina delle notizie.',
      '📰 Le fonti RSS personalizzate possono di nuovo caricare le copertine dalle pagine degli articoli quando il feed non include metadati immagine.',
      '📱 L\'aggiunta di fonti RSS personalizzate e piu affidabile su mobile perche le nuove fonti vengono salvate prima del primo refresh in background.',
      '🛠️ L\'eliminazione degli utenti dalla dashboard admin aggiorna subito la lista dopo una cancellazione riuscita.',
      '🔄 L\'aggiornamento manuale ora usa un breve cooldown e un controllo condiviso sulla freschezza delle fonti per mantenere le notizie tempestive senza sovraccaricare i provider RSS.',
      '⚡ La paginazione del feed e piu veloce e stabile sui feed grandi, soprattutto quando molte storie hanno lo stesso orario di pubblicazione.',
      '🧭 Le fonti RSS lente non bloccano piu gli aggiornamenti di altri utenti e la validazione dei feed personalizzati fallisce piu rapidamente quando un provider non risponde.',
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
