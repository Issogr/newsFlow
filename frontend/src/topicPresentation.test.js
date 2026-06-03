import { getTopicPresentation } from './topicPresentation';
import { Cpu, Film } from 'lucide-react';

describe('getTopicPresentation', () => {
  test('does not classify entertainment as technology because it contains ai', () => {
    expect(getTopicPresentation('Entertainment').Icon).toBe(Film);
    expect(getTopicPresentation('AI').Icon).toBe(Cpu);
  });
});
