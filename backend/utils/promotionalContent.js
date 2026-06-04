const PROMOTIONAL_DEAL_PATTERN = /\b(deal|deals|discount|discounts|sale|sales|coupon|coupons|promo|promotion|offer|offers|offerta|offerte|sconto|sconti|saldi|minimo storico|minimi storici|lowest price|lowest prices|best price|best prices|price drop|price drops|record low|record-low|all-time low|deal alert|black friday|cyber monday|prime day|gift card|carta regalo|cashback|prezzo migliore|prezzi migliori|miglior prezzo|migliori prezzi|prezzo piu basso|prezzi piu bassi|calo di prezzo)\b/u;
const PRICE_PATTERN = /(?:[$€£]\s?\d|\b\d+(?:[.,]\d{2})?\s?(?:dollari|euro|usd|eur)\b)/u;
const RETAILER_PATTERN = /\b(best buy|amazon|walmart|target|ebay|mediaworld|unieuro|euronics|store|shop|shopping|buy|preorder|pre-order|acquista|compra|carrello|retailer|rivenditore)\b/u;
const PRODUCT_DEAL_PATTERN = /\b(tv|oled|lamp|monitor|laptop|notebook|tablet|phone|iphone|ipad|smartwatch|watch|headphones|earbuds|speaker|router|ssd|console|camera|vacuum|robot|keyboard|mouse|adapter|adaptor|bluetooth|airfly|televisore|lampada|adattatore|cuffie|auricolari|friggitrice)\b/u;
const DEAL_URL_PATTERN = /(?:^|\/)(deals?|shopping|coupon|promo|offers?|black-friday|cyber-monday)(?:\/|$|-|_)/u;

function normalizePromotionalDetectionText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function hasPromotionalDealCue(value = '') {
  const normalizedText = normalizePromotionalDetectionText(value);
  return PROMOTIONAL_DEAL_PATTERN.test(normalizedText)
    || /\b(?:best|top)\b.{0,50}\b(?:deals?|discounts?|offers?|sconti|offerte|prices?|prezzi)\b/u.test(normalizedText);
}

function isPromotionalDealText(value = '') {
  const normalizedText = normalizePromotionalDetectionText(value);
  if (!normalizedText || !hasPromotionalDealCue(normalizedText)) {
    return false;
  }

  return PRICE_PATTERN.test(normalizedText)
    || RETAILER_PATTERN.test(normalizedText)
    || PRODUCT_DEAL_PATTERN.test(normalizedText)
    || DEAL_URL_PATTERN.test(normalizedText);
}

function isPromotionalDealArticle(article = {}) {
  return isPromotionalDealText([
    article.title,
    article.description,
    article.content,
    article.url
  ].filter(Boolean).join(' '));
}

function splitSentences(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=(?:["'“”‘’])?[A-ZÀ-ÖØ-Þ0-9])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function removePromotionalSentences(value = '') {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const paragraphs = text.split(/\n{2,}/u).map((paragraph) => {
    const sentences = splitSentences(paragraph);
    if (sentences.length === 0) {
      return '';
    }

    return sentences
      .filter((sentence) => !isPromotionalDealText(sentence))
      .join(' ')
      .trim();
  }).filter(Boolean);

  return paragraphs.join('\n\n').trim();
}

module.exports = {
  isPromotionalDealArticle,
  removePromotionalSentences
};
