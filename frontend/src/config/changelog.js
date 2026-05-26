export const CURRENT_CHANGELOG_ENTRY = {
  version: '3.5.0',
  en: {
    eyebrow: 'Latest update',
    title: 'What is new',
    intro: 'A quick summary of the latest update.',
    items: [
      '🎧 A new podcast briefing appears first in the topic story rail, generated from the same scheduled summary articles, with English/Italian scripts based on your app language and Italian Gemini TTS audio when available.',
      '⚡ Podcast audio streams through the browser, while generation validates scripts and audio, caps TTS input size, retries failed audio without regenerating scripts, and stitches natural Gemini chunks into one WAV to avoid truncated narration with shorter pauses.',
      '🧽 Older summary and podcast rows are removed after a replacement exists for the current scheduled window.',
      '🧩 AI story grouping checks more nearby candidates, retries recent misses, and records match evidence while keeping model input small.',
      '📰 Thematic summaries now wait for topic classification, validate citations, and show an explicit empty-window message when no topic news is available.',
      '🛡️ Feed pagination, session handling, and settings drafts are more reliable.'
    ]
  },
  it: {
    eyebrow: 'Ultimo aggiornamento',
    title: 'Novita',
    intro: 'Un riepilogo rapido dell\'ultimo aggiornamento.',
    items: [
      '🎧 Un nuovo briefing podcast appare per primo nella barra delle storie per topic, generato dagli stessi articoli delle sintesi programmate, con testi in inglese/italiano in base alla lingua dell\'app e audio italiano Gemini TTS quando disponibile.',
      '⚡ L\'audio podcast viene riprodotto in streaming dal browser; la generazione valida testi e audio, limita l\'input TTS, ritenta l\'audio fallito senza rigenerare i testi e unisce segmenti Gemini naturali in un unico WAV per evitare narrazioni troncate con pause piu brevi.',
      '🧽 Le righe vecchie di sintesi e podcast vengono rimosse dopo che esiste una sostituzione per la finestra programmata corrente.',
      '🧩 Il raggruppamento AI delle storie controlla piu candidati vicini, ritenta i match recenti mancati e conserva le prove del match mantenendo piccolo l\'input del modello.',
      '📰 Le sintesi tematiche ora aspettano la classificazione dei topic, validano le citazioni e mostrano un messaggio esplicito quando non ci sono notizie per la finestra.',
      '🛡️ Paginazione del feed, sessioni e bozze delle impostazioni sono piu affidabili.'
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
