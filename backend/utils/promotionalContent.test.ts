const { isPromotionalDealArticle, removePromotionalSentences } = require('./promotionalContent');

describe('promotional content filtering', () => {
  test.each([
    'Amazon signs a $5 billion deal to build new data centers',
    'Apple reports record iPhone sales after quarterly earnings',
    'Amazon offre nuovi posti di lavoro nel suo centro logistico',
    'Le vendite di iPhone scendono al minimo da tre anni',
    'The company offers to buy a retailer for $2 billion'
  ])('preserves business news: %s', (title) => {
    expect(isPromotionalDealArticle({ title })).toBe(false);
    expect(removePromotionalSentences(`${title} [1].`)).toBe(`${title} [1].`);
  });

  test.each([
    'This laptop is on sale for $499 at Best Buy',
    'Save with a coupon: these headphones are 30% off at Amazon',
    'Il tablet è in offerta su Amazon a 199 euro',
    'Le cuffie Bluetooth sono al miglior prezzo con il 20% di sconto',
    'The AirFly adapter reaches one of its best prices'
  ])('removes a shopping promotion: %s', (title) => {
    expect(isPromotionalDealArticle({ title })).toBe(true);
    expect(removePromotionalSentences(`${title}.`)).toBe('');
  });

  test('recognizes deal pages and preserves surrounding news sentences', () => {
    expect(isPromotionalDealArticle({ title: 'Our picks', url: 'https://example.com/deals/weekend' })).toBe(true);
    expect(removePromotionalSentences('Apple reports record iPhone sales [1]. This tablet is on sale for $99 [2]. Regulators opened an investigation [3].'))
      .toBe('Apple reports record iPhone sales [1]. Regulators opened an investigation [3].');
  });
});
