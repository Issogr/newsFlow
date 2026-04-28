import {
  Briefcase,
  Cpu,
  Film,
  FlaskConical,
  Globe2,
  HeartPulse,
  Landmark,
  Leaf,
  Newspaper,
  Palette,
  Shield,
  Tags,
  Trophy
} from 'lucide-react';

const TOPIC_BADGE_CLASSES = {
  politics: 'bg-[#F7E3A1] text-[#6B4A0F] ring-1 ring-inset ring-[#D4B15A] hover:bg-[#F2D98B]',
  economy: 'bg-[#CDEFD8] text-[#14532D] ring-1 ring-inset ring-[#7BC79A] hover:bg-[#BDE7CC]',
  technology: 'bg-[#DAD8FB] text-[#3730A3] ring-1 ring-inset ring-[#A5A0F0] hover:bg-[#CCC8F8]',
  science: 'bg-[#E7D8FB] text-[#6B21A8] ring-1 ring-inset ring-[#C39BEE] hover:bg-[#DDC7F8]',
  sport: 'bg-[#E3F4B5] text-[#3F6212] ring-1 ring-inset ring-[#B8D56A] hover:bg-[#D9EE9F]',
  culture: 'bg-[#F9D5EE] text-[#9D174D] ring-1 ring-inset ring-[#ECA5D8] hover:bg-[#F5C4E6]',
  health: 'bg-[#FFD9E6] text-[#9F1239] ring-1 ring-inset ring-[#F3A8BE] hover:bg-[#FBC9D9]',
  localNews: 'bg-[#E6DDD6] text-[#57534E] ring-1 ring-inset ring-[#C6B8AE] hover:bg-[#DDD2CA]',
  entertainment: 'bg-[#FFDDBA] text-[#9A3412] ring-1 ring-inset ring-[#F0B274] hover:bg-[#FFD1A1]',
  world: 'bg-[#D7ECFF] text-[#0C4A6E] ring-1 ring-inset ring-[#9CCBF4] hover:bg-[#C8E4FF]',
  climate: 'bg-[#CDEFE8] text-[#115E59] ring-1 ring-inset ring-[#86D4C4] hover:bg-[#BEE8DE]',
  security: 'bg-[#F8D3D7] text-[#991B1B] ring-1 ring-inset ring-[#E6A3AF] hover:bg-[#F4C4CA]',
  fallback: 'bg-[#E2E8F0] text-[#334155] ring-1 ring-inset ring-[#B8C4D4] hover:bg-[#D7E0EA]'
};

function normalizeTopic(topic) {
  return String(topic || '').trim().toLowerCase();
}

function createTopicPresentation(Icon, iconBadgeClassName) {
  return {
    Icon,
    className: iconBadgeClassName,
    iconBadgeClassName
  };
}

export function getTopicPresentation(topic) {
  const normalized = normalizeTopic(topic);

  if (/(politic|politica|government|governo|election|elezion|parliament|parlamento)/.test(normalized)) {
    return createTopicPresentation(Landmark, TOPIC_BADGE_CLASSES.politics);
  }

  if (/(econom|market|mercat|business|finance|finanz)/.test(normalized)) {
    return createTopicPresentation(Briefcase, TOPIC_BADGE_CLASSES.economy);
  }

  if (/(tech|tecnolog|ai|software|digital|startup)/.test(normalized)) {
    return createTopicPresentation(Cpu, TOPIC_BADGE_CLASSES.technology);
  }

  if (/(science|scienz|research|ricerca|space|spazio)/.test(normalized)) {
    return createTopicPresentation(FlaskConical, TOPIC_BADGE_CLASSES.science);
  }

  if (/(sport|football|calcio|tennis|basket|olympic|formula 1|motogp)/.test(normalized)) {
    return createTopicPresentation(Trophy, TOPIC_BADGE_CLASSES.sport);
  }

  if (/(culture|cultura|art|arte|book|libri|museum|museo|teatro)/.test(normalized)) {
    return createTopicPresentation(Palette, TOPIC_BADGE_CLASSES.culture);
  }

  if (/(health|salute|sanita|medicine|medicina|hospital|ospedale|vaccin|virus)/.test(normalized)) {
    return createTopicPresentation(HeartPulse, TOPIC_BADGE_CLASSES.health);
  }

  if (/(cronaca|local news|crime)/.test(normalized)) {
    return createTopicPresentation(Newspaper, TOPIC_BADGE_CLASSES.localNews);
  }

  if (/(spettacolo|entertainment|cinema|film|music|musica|tv|televisione|celebrity)/.test(normalized)) {
    return createTopicPresentation(Film, TOPIC_BADGE_CLASSES.entertainment);
  }

  if (/(world|esteri|international|europa|europe|global)/.test(normalized)) {
    return createTopicPresentation(Globe2, TOPIC_BADGE_CLASSES.world);
  }

  if (/(climate|clima|environment|ambiente|green|energia)/.test(normalized)) {
    return createTopicPresentation(Leaf, TOPIC_BADGE_CLASSES.climate);
  }

  if (/(security|sicurezza|war|guerra|defense|difesa)/.test(normalized)) {
    return createTopicPresentation(Shield, TOPIC_BADGE_CLASSES.security);
  }

  return createTopicPresentation(Tags, TOPIC_BADGE_CLASSES.fallback);
}
