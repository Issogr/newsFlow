import { getTopicPresentation } from './topicPresentation';
import {
  Briefcase,
  Cpu,
  Film,
  FlaskConical,
  Globe2,
  Headphones,
  HeartPulse,
  Landmark,
  Leaf,
  Newspaper,
  Palette,
  Shield,
  Tags,
  Trophy
} from 'lucide-react';

describe('getTopicPresentation', () => {
  test.each([
    ['Politics', Landmark],
    ['Economy', Briefcase],
    ['AI', Cpu],
    ['Science', FlaskConical],
    ['Sport', Trophy],
    ['Culture', Palette],
    ['Health', HeartPulse],
    ['Cronaca', Newspaper],
    ['Entertainment', Film],
    ['World', Globe2],
    ['Climate', Leaf],
    ['Security', Shield],
    ['Podcast', Headphones],
    ['Unknown', Tags]
  ])('maps %s to its presentation', (topic, Icon) => {
    expect(getTopicPresentation(topic).Icon).toBe(Icon);
  });
});
