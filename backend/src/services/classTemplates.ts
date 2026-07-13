/**
 * Life-domain → class template mapping (Sprint S1 — no AI).
 * Templates mirror GAMIFICATION-UI-PUBLIC-ROADMAP Phase 3.2 archetypes.
 */

export interface ClassTemplate {
  id: string;
  name: string;
  slug: string;
  tagline: string;
  primaryDomains: string[];
}

/** Selectable life domains (signup step 2). */
export const LIFE_DOMAINS = [
  // Physical
  'Strength Training',
  'Martial Arts',
  'Endurance',
  'Swimming',
  'Sport',
  // Mental
  'Programming/Tech',
  'Security/Hacking',
  'Finance',
  'Language',
  'Chess',
  // Creative
  'Music',
  'Visual Art',
  'Writing',
  'Game Design',
  // Spiritual
  'Prayer/Meditation',
  'Philosophy',
  'Service',
  // Social
  'Leadership',
  'Relationships',
  'Mentorship',
] as const;

export type LifeDomain = (typeof LIFE_DOMAINS)[number];

export const CLASS_TEMPLATES: ClassTemplate[] = [
  {
    id: 'paladin',
    name: 'Paladin',
    slug: 'paladin',
    tagline: 'Faith, strength, and disciplined daily law',
    primaryDomains: ['Prayer/Meditation', 'Strength Training', 'Service', 'Philosophy'],
  },
  {
    id: 'shadow-assassin',
    name: 'Shadow Assassin',
    slug: 'shadow-assassin',
    tagline: 'Tech, security, and precision under pressure',
    primaryDomains: ['Security/Hacking', 'Programming/Tech', 'Chess'],
  },
  {
    id: 'berserker',
    name: 'Berserker',
    slug: 'berserker',
    tagline: 'Strength, combat, and relentless endurance',
    primaryDomains: ['Strength Training', 'Martial Arts', 'Endurance', 'Sport'],
  },
  {
    id: 'sage',
    name: 'Sage',
    slug: 'sage',
    tagline: 'Study, language, finance, and deep work',
    primaryDomains: ['Language', 'Finance', 'Chess', 'Philosophy', 'Programming/Tech'],
  },
  {
    id: 'artificer',
    name: 'Artificer',
    slug: 'artificer',
    tagline: 'Music, art, writing, and game craft',
    primaryDomains: ['Music', 'Visual Art', 'Writing', 'Game Design'],
  },
  {
    id: 'merchant',
    name: 'Merchant',
    slug: 'merchant',
    tagline: 'Finance, leadership, and entrepreneurial execution',
    primaryDomains: ['Finance', 'Leadership', 'Mentorship', 'Relationships'],
  },
  {
    id: 'druid',
    name: 'Druid',
    slug: 'druid',
    tagline: 'Health, nature, recovery, and embodied practice',
    primaryDomains: ['Endurance', 'Swimming', 'Sport', 'Prayer/Meditation', 'Service'],
  },
];

const DOMAIN_SET = new Set<string>(LIFE_DOMAINS);

export function isLifeDomain(value: string): value is LifeDomain {
  return DOMAIN_SET.has(value);
}

export function normalizeDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const d = raw.trim();
    if (isLifeDomain(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

/**
 * Deterministic domain → template suggestion.
 * Score = overlap with primaryDomains; ties broken by template order.
 */
export function suggestClassTemplate(domains: string[]): ClassTemplate {
  if (domains.length === 0) {
    return CLASS_TEMPLATES[0];
  }

  let best = CLASS_TEMPLATES[0];
  let bestScore = -1;

  for (const t of CLASS_TEMPLATES) {
    const score = t.primaryDomains.filter(d => domains.includes(d)).length;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }

  // If nothing matched, bias tech vs physical vs creative heuristics
  if (bestScore === 0) {
    if (domains.some(d => d.includes('Security') || d.includes('Programming'))) {
      return CLASS_TEMPLATES.find(t => t.id === 'shadow-assassin')!;
    }
    if (domains.some(d => ['Strength Training', 'Martial Arts', 'Endurance'].includes(d))) {
      return CLASS_TEMPLATES.find(t => t.id === 'berserker')!;
    }
    if (domains.some(d => ['Music', 'Visual Art', 'Writing', 'Game Design'].includes(d))) {
      return CLASS_TEMPLATES.find(t => t.id === 'artificer')!;
    }
  }

  return best;
}
