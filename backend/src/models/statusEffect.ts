export interface EffectStat {
  stat: string;              // e.g. "Testosterone", "Sleep Quality", "Focus", "Physical Fatigue"
  modifier: string;          // e.g. "+15%", "-20%", "−Tier 1", "+10 XP/hr"
  direction: 'positive' | 'negative';
}

export type StatusEffectType = 'buff' | 'debuff' | 'mixed';
export type StatusEffectCategory = 'substance' | 'illness' | 'training' | 'environmental' | 'food' | 'other';

export interface StatusEffect {
  id: string;                // UUID
  name: string;              // e.g. "Allergy Resistance", "Caffeine Clarity", "Alcohol Shadow"
  type: StatusEffectType;
  category: StatusEffectCategory;
  source: string;            // e.g. "Coffee", "Allergy exposure", "Alcohol - 2 drinks"
  icon: string;              // emoji
  effects: EffectStat[];
  appliedAt: string;         // ISO timestamp
  duration: number;          // minutes (-1 = indefinite)
  expiresAt: string | null;  // ISO timestamp or null for indefinite
  notes?: string;
}

// ─── Pre-defined templates for common effects ─────────────────────────────

export const STATUS_EFFECT_TEMPLATES: Omit<StatusEffect, 'id' | 'appliedAt' | 'expiresAt'>[] = [
  {
    name: 'Allergy Resistance',
    type: 'buff',
    category: 'environmental',
    source: 'Allergy exposure',
    icon: '🌿',
    duration: 1440, // 24 hrs
    effects: [
      { stat: 'Immune Adaptation',  modifier: '+Tier 1',  direction: 'positive' },
      { stat: 'Histamine Tolerance', modifier: '+10%',    direction: 'positive' },
    ],
  },
  {
    name: 'Caffeine Clarity',
    type: 'buff',
    category: 'substance',
    source: 'Coffee / Caffeine',
    icon: '☕',
    duration: 360, // 6 hrs
    effects: [
      { stat: 'Focus',            modifier: '+20%',   direction: 'positive' },
      { stat: 'Physical Fatigue', modifier: '−Tier 1', direction: 'positive' },
      { stat: 'Mental Clarity',   modifier: '+15%',   direction: 'positive' },
    ],
  },
  {
    name: 'Caffeine Crash',
    type: 'debuff',
    category: 'substance',
    source: 'Caffeine withdrawal',
    icon: '💤',
    duration: 120, // 2 hrs
    effects: [
      { stat: 'Focus',           modifier: '−20%',   direction: 'negative' },
      { stat: 'Mental Energy',   modifier: '−15%',   direction: 'negative' },
    ],
  },
  {
    name: 'Alcohol Effect',
    type: 'mixed',
    category: 'substance',
    source: 'Alcohol',
    icon: '🍺',
    duration: 480, // 8 hrs
    effects: [
      { stat: 'Pleasure / Social Freedom', modifier: '+High',   direction: 'positive' },
      { stat: 'Testosterone',              modifier: '−15%',    direction: 'negative' },
      { stat: 'Sleep Quality',             modifier: '−30%',    direction: 'negative' },
      { stat: 'Recovery Rate',             modifier: '−25%',    direction: 'negative' },
      { stat: 'XP Consolidation',          modifier: '−10%',    direction: 'negative' },
    ],
  },
  {
    name: 'Excellent Sleep Bonus',
    type: 'buff',
    category: 'training',
    source: 'Sleep quality ≥ 85',
    icon: '🌙',
    duration: 720, // 12 hrs
    effects: [
      { stat: 'XP Consolidation', modifier: '+15%',   direction: 'positive' },
      { stat: 'Recovery Rate',    modifier: '+20%',   direction: 'positive' },
      { stat: 'Vitality',         modifier: '+5 pts', direction: 'positive' },
    ],
  },
  {
    name: 'Poor Sleep Penalty',
    type: 'debuff',
    category: 'training',
    source: 'Sleep quality < 60',
    icon: '😴',
    duration: 480, // 8 hrs
    effects: [
      { stat: 'Focus',            modifier: '−20%',   direction: 'negative' },
      { stat: 'Physical Output',  modifier: '−15%',   direction: 'negative' },
      { stat: 'XP Consolidation', modifier: '−10%',   direction: 'negative' },
    ],
  },
  {
    name: 'Post-Workout Recovery',
    type: 'buff',
    category: 'training',
    source: 'Resistance training',
    icon: '💪',
    duration: 2880, // 48 hrs
    effects: [
      { stat: 'Muscle Adaptation', modifier: '+Tier 1',  direction: 'positive' },
      { stat: 'Strength Growth',   modifier: '+Active',  direction: 'positive' },
    ],
  },
  {
    name: 'DOMS / Muscle Fatigue',
    type: 'debuff',
    category: 'training',
    source: 'Intense training',
    icon: '🔥',
    duration: 2880, // 48 hrs
    effects: [
      { stat: 'Physical Output',  modifier: '−20%',   direction: 'negative' },
      { stat: 'Mobility',         modifier: '−Tier 1', direction: 'negative' },
    ],
  },
  {
    name: 'Sugar Rush',
    type: 'mixed',
    category: 'food',
    source: 'High sugar intake',
    icon: '🍬',
    duration: 60, // 1 hr
    effects: [
      { stat: 'Energy',    modifier: '+Spike',  direction: 'positive' },
      { stat: 'Focus',     modifier: '−15%',    direction: 'negative' },
      { stat: 'Insulin',   modifier: '+Elevated', direction: 'negative' },
    ],
  },
  {
    name: 'Fasted State',
    type: 'buff',
    category: 'food',
    source: 'Intermittent fasting (≥12h)',
    icon: '⚡',
    duration: -1, // until eating
    effects: [
      { stat: 'Mental Clarity',  modifier: '+15%',   direction: 'positive' },
      { stat: 'Fat Oxidation',   modifier: '+20%',   direction: 'positive' },
      { stat: 'HGH Pulse',       modifier: '+Active', direction: 'positive' },
    ],
  },
  {
    name: 'Dehydration',
    type: 'debuff',
    category: 'environmental',
    source: 'Low water intake',
    icon: '💧',
    duration: -1, // until hydrated
    effects: [
      { stat: 'Focus',           modifier: '−25%',   direction: 'negative' },
      { stat: 'Physical Output', modifier: '−15%',   direction: 'negative' },
      { stat: 'Vitality',        modifier: '−5 pts', direction: 'negative' },
    ],
  },
  {
    name: 'High Protein Synthesis',
    type: 'buff',
    category: 'food',
    source: 'Protein goal met (0.64g/lb+)',
    icon: '🥩',
    duration: 1440, // 24 hrs
    effects: [
      { stat: 'Muscle Synthesis',  modifier: '+Optimal', direction: 'positive' },
      { stat: 'Recovery Rate',     modifier: '+15%',     direction: 'positive' },
    ],
  },
];
