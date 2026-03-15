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
    return createTopicPresentation(Landmark, 'bg-amber-100 text-amber-700 hover:bg-amber-200');
  }

  if (/(econom|market|mercat|business|finance|finanz)/.test(normalized)) {
    return createTopicPresentation(Briefcase, 'bg-sky-100 text-sky-700 hover:bg-sky-200');
  }

  if (/(tech|tecnolog|ai|software|digital|startup)/.test(normalized)) {
    return createTopicPresentation(Cpu, 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200');
  }

  if (/(science|scienz|research|ricerca|space|spazio)/.test(normalized)) {
    return createTopicPresentation(FlaskConical, 'bg-violet-100 text-violet-700 hover:bg-violet-200');
  }

  if (/(sport|football|calcio|tennis|basket|olympic|formula 1|motogp)/.test(normalized)) {
    return createTopicPresentation(Trophy, 'bg-lime-100 text-lime-700 hover:bg-lime-200');
  }

  if (/(culture|cultura|art|arte|book|libri|museum|museo|teatro)/.test(normalized)) {
    return createTopicPresentation(Palette, 'bg-fuchsia-100 text-fuchsia-700 hover:bg-fuchsia-200');
  }

  if (/(health|salute|sanita|medicine|medicina|hospital|ospedale|vaccin|virus)/.test(normalized)) {
    return createTopicPresentation(HeartPulse, 'bg-pink-100 text-pink-700 hover:bg-pink-200');
  }

  if (/(cronaca|local news|crime)/.test(normalized)) {
    return createTopicPresentation(Newspaper, 'bg-orange-100 text-orange-700 hover:bg-orange-200');
  }

  if (/(spettacolo|entertainment|cinema|film|music|musica|tv|televisione|celebrity)/.test(normalized)) {
    return createTopicPresentation(Film, 'bg-purple-100 text-purple-700 hover:bg-purple-200');
  }

  if (/(world|esteri|international|europa|europe|global)/.test(normalized)) {
    return createTopicPresentation(Globe2, 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200');
  }

  if (/(climate|clima|environment|ambiente|green|energia)/.test(normalized)) {
    return createTopicPresentation(Leaf, 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200');
  }

  if (/(security|sicurezza|war|guerra|defense|difesa)/.test(normalized)) {
    return createTopicPresentation(Shield, 'bg-rose-100 text-rose-700 hover:bg-rose-200');
  }

  return createTopicPresentation(Tags, 'bg-slate-100 text-slate-700 hover:bg-slate-200');
}
