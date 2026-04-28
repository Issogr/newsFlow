import { getTopicPresentation } from './topicPresentation';

describe('getTopicPresentation', () => {
  test('uses a unique badge palette for each topic family', () => {
    const topicSamples = [
      'Politica',
      'Economia',
      'Tecnologia',
      'Scienza',
      'Sport',
      'Cultura',
      'Salute',
      'Cronaca',
      'Spettacolo',
      'Esteri',
      'Ambiente',
      'Security',
      'Misc'
    ];

    const classNames = topicSamples.map((topic) => getTopicPresentation(topic).iconBadgeClassName);

    expect(new Set(classNames)).toHaveLength(topicSamples.length);
  });

  test('uses explicit palette values so dark-mode utility overrides do not wash out some topics', () => {
    const topicSamples = ['Politica', 'Economia', 'Cronaca', 'Esteri', 'Misc'];

    topicSamples.forEach((topic) => {
      expect(getTopicPresentation(topic).iconBadgeClassName).toContain('bg-[#');
    });
  });
});
