import { getTopicPresentation } from './topicPresentation';

describe('getTopicPresentation', () => {
  test('keeps topic families visually distinguishable with explicit badge palettes', () => {
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

    ['Politica', 'Economia', 'Cronaca', 'Esteri', 'Misc'].forEach((topic) => {
      expect(getTopicPresentation(topic).iconBadgeClassName).toContain('bg-[#');
    });
  });
});
