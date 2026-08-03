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
  podcast: 'bg-[#D8F3FF] text-[#075985] ring-1 ring-inset ring-[#83D4F2] hover:bg-[#C7EEFF]',
  fallback: 'bg-[#E2E8F0] text-[#334155] ring-1 ring-inset ring-[#B8C4D4] hover:bg-[#D7E0EA]'
};

export const AI_ACCENT_GRADIENT_STYLE = {
  backgroundImage: 'conic-gradient(from 20deg, #f97316, #facc15, #22c55e, #06b6d4, #6366f1, #d946ef, #f97316)'
};

const TOPIC_PRESENTATIONS = [
  { pattern: /(politic|politica|government|governo|election|elezion|parliament|parlamento)/, Icon: Landmark, badge: TOPIC_BADGE_CLASSES.politics },
  { pattern: /(econom|market|mercat|business|finance|finanz)/, Icon: Briefcase, badge: TOPIC_BADGE_CLASSES.economy },
  { pattern: /(tech|tecnolog|\bai\b|artificial intelligence|intelligenza artificiale|software|digital|startup)/, Icon: Cpu, badge: TOPIC_BADGE_CLASSES.technology },
  { pattern: /(science|scienz|research|ricerca|space|spazio)/, Icon: FlaskConical, badge: TOPIC_BADGE_CLASSES.science },
  { pattern: /(sport|football|calcio|tennis|basket|olympic|formula 1|motogp)/, Icon: Trophy, badge: TOPIC_BADGE_CLASSES.sport },
  { pattern: /(culture|cultura|art|arte|book|libri|museum|museo|teatro)/, Icon: Palette, badge: TOPIC_BADGE_CLASSES.culture },
  { pattern: /(health|salute|sanita|medicine|medicina|hospital|ospedale|vaccin|virus)/, Icon: HeartPulse, badge: TOPIC_BADGE_CLASSES.health },
  { pattern: /(cronaca|local news|crime)/, Icon: Newspaper, badge: TOPIC_BADGE_CLASSES.localNews },
  { pattern: /(spettacolo|entertainment|cinema|film|music|musica|tv|televisione|celebrity)/, Icon: Film, badge: TOPIC_BADGE_CLASSES.entertainment },
  { pattern: /(world|esteri|international|europa|europe|global)/, Icon: Globe2, badge: TOPIC_BADGE_CLASSES.world },
  { pattern: /(climate|clima|environment|ambiente|green|energia)/, Icon: Leaf, badge: TOPIC_BADGE_CLASSES.climate },
  { pattern: /(security|sicurezza|war|guerra|defense|difesa)/, Icon: Shield, badge: TOPIC_BADGE_CLASSES.security },
  { pattern: /(podcast|audio|briefing)/, Icon: Headphones, badge: TOPIC_BADGE_CLASSES.podcast }
];

export function getTopicPresentation(topic: unknown) {
  const normalized = String(topic || '').trim().toLowerCase();
  const presentation = TOPIC_PRESENTATIONS.find(({ pattern }) => pattern.test(normalized));
  return {
    Icon: presentation?.Icon || Tags,
    iconBadgeClassName: presentation?.badge || TOPIC_BADGE_CLASSES.fallback
  };
}
