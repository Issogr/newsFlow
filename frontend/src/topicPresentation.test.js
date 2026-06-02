import { getTopicPresentation } from './topicPresentation';
import { Cpu, Film } from 'lucide-react';

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

  test('does not classify entertainment as technology because it contains ai', () => {
    expect(getTopicPresentation('Entertainment').Icon).toBe(Film);
    expect(getTopicPresentation('AI').Icon).toBe(Cpu);
  });
});
