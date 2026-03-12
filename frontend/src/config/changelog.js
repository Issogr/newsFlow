export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.2.2',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'Here is a quick overview of the latest changes in News Flow.',
    items: [
      '🧭 Duplicate protection is stronger: refreshes now identify articles by canonical source URL before falling back to feed GUIDs.',
      '🧹 Existing same-source duplicates are cleaned up automatically by a database migration that normalizes article URLs.',
      '🛡️ The database now enforces per-source canonical URL uniqueness to stop duplicate inserts even if feed metadata changes.',
      '✅ Added regression coverage for feeds that change GUIDs, tracking parameters, or timestamps across refreshes.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Ecco una panoramica rapida delle ultime novita di News Flow.',
    items: [
      '🧭 Protezione duplicati piu solida: durante il refresh gli articoli vengono riconosciuti prima tramite URL canonico della fonte e solo dopo tramite GUID del feed.',
      '🧹 I duplicati gia presenti della stessa fonte vengono ripuliti automaticamente da una migrazione che normalizza gli URL degli articoli.',
      '🛡️ Il database ora impone l\'unicita per fonte e URL canonico, cosi i duplicati non vengono reinseriti anche se cambiano i metadati del feed.',
      '✅ Aggiunti test di regressione per i feed che cambiano GUID, parametri di tracking o timestamp tra un refresh e l\'altro.'
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
