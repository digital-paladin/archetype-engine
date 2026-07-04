/**
 * Skill Tree Data — Digital Paladin Gamification System
 *
 * Each high-level activity (RedTeam, MMA, Strength, etc.) is broken down
 * into tangible techniques that can be individually unlocked and leveled.
 *
 * ESO-inspired rules:
 *  • Skills start LOCKED. They unlock when first practiced in a real session.
 *  • Multiple skill bars, each representing a discipline.
 *  • Combos award bonus XP when techniques are chained in sequence.
 */

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type SkillCategory =
  | 'utility'
  | 'redteam'
  | 'mma'
  | 'strength'
  | 'swimming'
  | 'guitar'
  | 'coding'
  | 'sage';

export type SkillTier = 'basic' | 'intermediate' | 'advanced' | 'master';

export type ActionType = 'prayer' | 'workout' | 'coding' | 'redteam' | 'artist' | 'lab' | 'meal' | 'water' | 'fasting';

export interface Skill {
  id:              string;
  name:            string;
  icon:            string;
  category:        SkillCategory;
  description:     string;
  tier:            SkillTier;
  // Action tracking
  activityKey:     string;
  type:            ActionType;
  animation:       string;
  intensity:       'routine' | 'moderate' | 'complex';
  willpowerCost:   number;
  willpowerRegen:  number;
  // For exercise-type skills (strength, swimming technique drills)
  isExercise?:     boolean;
  exerciseType?:   'strength' | 'cardio' | 'technique';
}

export interface SkillBar {
  id:         SkillCategory;
  name:       string;
  icon:       string;
  colorClass: string;          // ESO palette CSS class
  skills:     string[];        // Ordered skill IDs in this bar
}

export interface ComboDefinition {
  id:          string;
  name:        string;
  description: string;
  skillIds:    string[];       // Ordered sequence of skill IDs to detect
  bonusXp:     number;
  category:    SkillCategory;
}

export interface ExerciseSet {
  reps:     number;
  weight?:  number;           // lbs/kg — optional for bodyweight
  rest?:    number;           // seconds — optional rest logged
}

// ─── ALL SKILLS ──────────────────────────────────────────────────────────────

export const ALL_SKILLS: Skill[] = [

  // ══════════════════════════════════════════════════════════════ UTILITY ══
  {
    id: 'hydrate', name: 'Hydrate', icon: '💧', category: 'utility',
    tier: 'basic', description: 'Hydration discipline — log a water intake.',
    activityKey: 'hydration', type: 'water', animation: 'Happy Idle',
    intensity: 'routine', willpowerCost: 0, willpowerRegen: 0
  },
  {
    id: 'deep-focus', name: 'Deep Focus', icon: '🧠', category: 'utility',
    tier: 'intermediate', description: 'Sustained concentrated session — any domain.',
    activityKey: 'deep-focus', type: 'coding', animation: 'Sitting Idle',
    intensity: 'moderate', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'log-day', name: 'Log Day', icon: '⚡', category: 'utility',
    tier: 'basic', description: 'Chronicle todays progress — daily log.',
    activityKey: 'daily-log', type: 'fasting', animation: 'Standing Idle',
    intensity: 'routine', willpowerCost: 0, willpowerRegen: 0
  },

  // ══════════════════════════════════════════════════════════════ REDTEAM ══
  // ✅ Unlocked: user has practiced these in labs
  {
    id: 'rt-xss', name: 'XSS', icon: '🔥', category: 'redteam',
    tier: 'basic', description: 'Cross-Site Scripting — inject malicious scripts into web pages.',
    activityKey: 'portswigger-labs', type: 'redteam', animation: 'Examining',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0
  },
  {
    id: 'rt-sqli', name: 'SQL Injection', icon: '💉', category: 'redteam',
    tier: 'basic', description: 'Inject SQL to extract or manipulate database data.',
    activityKey: 'portswigger-labs', type: 'redteam', animation: 'Examining',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0
  },
  // 🔒 Locked — unlock by practicing in a real lab
  {
    id: 'rt-idor', name: 'IDOR', icon: '🔑', category: 'redteam',
    tier: 'basic', description: 'Insecure Direct Object Reference — access unauthorised resources.',
    activityKey: 'htb-easy', type: 'redteam', animation: 'Examining',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0
  },
  {
    id: 'rt-csrf', name: 'CSRF', icon: '🪝', category: 'redteam',
    tier: 'basic', description: 'Cross-Site Request Forgery — forge authenticated requests.',
    activityKey: 'htb-easy', type: 'redteam', animation: 'Examining',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0
  },
  {
    id: 'rt-path', name: 'Path Traversal', icon: '📂', category: 'redteam',
    tier: 'basic', description: 'Directory traversal — access files outside web root.',
    activityKey: 'htb-easy', type: 'redteam', animation: 'Examining',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0
  },
  {
    id: 'rt-ssrf', name: 'SSRF', icon: '🌐', category: 'redteam',
    tier: 'intermediate', description: 'Server-Side Request Forgery — make server fetch internal resources.',
    activityKey: 'htb-medium', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-cmdi', name: 'Cmd Injection', icon: '⚡', category: 'redteam',
    tier: 'intermediate', description: 'Inject OS commands via vulnerable user input.',
    activityKey: 'htb-medium', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-xxe', name: 'XXE', icon: '📄', category: 'redteam',
    tier: 'intermediate', description: 'XML External Entity — parse malicious XML to read internal files.',
    activityKey: 'htb-medium', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-auth', name: 'Auth Bypass', icon: '🚪', category: 'redteam',
    tier: 'intermediate', description: 'Bypass authentication mechanisms to gain unauthorised access.',
    activityKey: 'htb-medium', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-jwt', name: 'JWT Manipulation', icon: '🔓', category: 'redteam',
    tier: 'advanced', description: 'Forge, tamper, or brute-force JWT tokens for privilege escalation.',
    activityKey: 'htb-hard', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-upload', name: 'Upload Bypass', icon: '📤', category: 'redteam',
    tier: 'intermediate', description: 'Bypass file upload restrictions to achieve remote code execution.',
    activityKey: 'htb-medium', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-bizlogic', name: 'Biz Logic', icon: '🧩', category: 'redteam',
    tier: 'advanced', description: 'Exploit flaws in application workflows and business logic.',
    activityKey: 'htb-hard', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'rt-privesc', name: 'Priv Escalation', icon: '👑', category: 'redteam',
    tier: 'advanced', description: 'Escalate privileges from user to admin or root.',
    activityKey: 'exploit-dev', type: 'redteam', animation: 'Examining',
    intensity: 'complex', willpowerCost: 20, willpowerRegen: 0
  },

  // ══════════════════════════════════════════════════════════════════ MMA ══
  // Strikes
  {
    id: 'mma-jab', name: 'Jab', icon: '👊', category: 'mma',
    tier: 'basic', description: 'Fast long-range strike — sets up combinations.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-cross', name: 'Cross', icon: '🤜', category: 'mma',
    tier: 'basic', description: 'Powerful rear-hand straight punch.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-hook', name: 'Hook', icon: '↩️', category: 'mma',
    tier: 'basic', description: 'Circular power strike targeting temple or jaw.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-uppercut', name: 'Uppercut', icon: '⬆️', category: 'mma',
    tier: 'basic', description: 'Upward strike to the chin — powerful finisher.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-bodyhook', name: 'Body Hook', icon: '💪', category: 'mma',
    tier: 'intermediate', description: 'Hook targeting liver or ribs — devastating mid-range.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-elbow', name: 'Elbow Strike', icon: '🦾', category: 'mma',
    tier: 'intermediate', description: 'Close-range elbow — devastating at clinch range.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 8, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-kick', name: 'Roundhouse', icon: '🦵', category: 'mma',
    tier: 'intermediate', description: 'Powerful kick targeting head or body.',
    activityKey: 'mma-class', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 7, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-knee', name: 'Knee Strike', icon: '🧎', category: 'mma',
    tier: 'intermediate', description: 'Devastating knee from clinch or flying approach.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 8, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  // Takedowns
  {
    id: 'mma-sltd', name: 'Single-Leg TD', icon: '🤼', category: 'mma',
    tier: 'intermediate', description: 'Shoot and secure a single-leg takedown.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 10, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-dltd', name: 'Double-Leg TD', icon: '🤸', category: 'mma',
    tier: 'advanced', description: 'Level change into a powerful double-leg takedown.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 10, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  // Submissions
  {
    id: 'mma-rnc', name: 'Rear Naked Choke', icon: '🔴', category: 'mma',
    tier: 'intermediate', description: 'Back control choke — the finishing position.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 10, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-guillotine', name: 'Guillotine', icon: '🔄', category: 'mma',
    tier: 'intermediate', description: 'Front headlock choke — powerful submission.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 10, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-kimura', name: 'Kimura', icon: '💜', category: 'mma',
    tier: 'advanced', description: 'Shoulder joint lock — force opponent to tap or break.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 12, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-armbar', name: 'Armbar', icon: '✋', category: 'mma',
    tier: 'advanced', description: 'Hyperextend the elbow joint from mount or guard.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 12, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'mma-triangle', name: 'Triangle Choke', icon: '🔺', category: 'mma',
    tier: 'advanced', description: 'Leg-based choke from guard position.',
    activityKey: 'sparring', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 12, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },

  // ═══════════════════════════════════════════════════════════ STRENGTH ══
  {
    id: 'str-bench', name: 'Bench Press', icon: '🏋', category: 'strength',
    tier: 'basic', description: 'Barbell horizontal press — primary chest builder.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-incbench', name: 'Incline Bench', icon: '📐', category: 'strength',
    tier: 'basic', description: 'Inclined press — upper chest and front delt emphasis.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 4, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-deadlift', name: 'Deadlift', icon: '⚡', category: 'strength',
    tier: 'basic', description: 'Conventional deadlift — king of compound movements.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 8, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-rdl', name: 'Romanian DL', icon: '🔄', category: 'strength',
    tier: 'intermediate', description: 'Hip hinge with straight legs — posterior chain focus.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-squat', name: 'Back Squat', icon: '🦵', category: 'strength',
    tier: 'basic', description: 'Barbell back squat — primary quad and glute builder.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 8, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-pullup', name: 'Pull-Up', icon: '⬆️', category: 'strength',
    tier: 'basic', description: 'Bodyweight vertical pull — lat and bicep strength.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-row', name: 'Barbell Row', icon: '↔️', category: 'strength',
    tier: 'basic', description: 'Horizontal pull — back thickness and strength.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-ohp', name: 'Overhead Press', icon: '🙌', category: 'strength',
    tier: 'basic', description: 'Barbell vertical press — shoulder and tricep builder.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-curl', name: 'Barbell Curl', icon: '💪', category: 'strength',
    tier: 'basic', description: 'Standing barbell curl — peak bicep mass builder.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-tripdwn', name: 'Tricep Pushdown', icon: '⬇️', category: 'strength',
    tier: 'basic', description: 'Cable pushdown for tricep isolation.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-latpd', name: 'Lat Pulldown', icon: '🎯', category: 'strength',
    tier: 'basic', description: 'Machine vertical pull — lat width development.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-cablerow', name: 'Cable Row', icon: '🔃', category: 'strength',
    tier: 'basic', description: 'Seated cable row — mid-back and rhomboid thickness.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-hipt', name: 'Hip Thrust', icon: '🔼', category: 'strength',
    tier: 'intermediate', description: 'Glute-dominant barbell hip thrust — glute max builder.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-facepull', name: 'Face Pull', icon: '🎪', category: 'strength',
    tier: 'basic', description: 'Rear delt and rotator cuff — shoulder prehab.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 2, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },
  {
    id: 'str-dip', name: 'Dip', icon: '🔻', category: 'strength',
    tier: 'basic', description: 'Parallel bar dip — chest and tricep compound.',
    activityKey: 'workout-strength', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'strength'
  },

  // ═══════════════════════════════════════════════════════════ SWIMMING ══
  {
    id: 'sw-float', name: 'Static Float', icon: '🫧', category: 'swimming',
    tier: 'basic', description: 'Controlled floating — foundational buoyancy control.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'sw-seal', name: 'Seal Roll', icon: '🔄', category: 'swimming',
    tier: 'basic', description: 'Rotational body roll — essential for freestyle.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'sw-free', name: 'Freestyle', icon: '🏊', category: 'swimming',
    tier: 'basic', description: 'Front crawl — primary competitive stroke.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0,
    isExercise: true, exerciseType: 'cardio'
  },
  {
    id: 'sw-back', name: 'Backstroke', icon: '↩️', category: 'swimming',
    tier: 'basic', description: 'Back crawl — builds shoulder flexibility.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 10, willpowerRegen: 0,
    isExercise: true, exerciseType: 'cardio'
  },
  {
    id: 'sw-breast', name: 'Breaststroke', icon: '🐸', category: 'swimming',
    tier: 'intermediate', description: 'Arm pull and frog kick — technical timing required.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0,
    isExercise: true, exerciseType: 'cardio'
  },
  {
    id: 'sw-butterfly', name: 'Butterfly', icon: '🦋', category: 'swimming',
    tier: 'advanced', description: 'Dolphin kick and simultaneous arm pull — most demanding stroke.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'complex', willpowerCost: 18, willpowerRegen: 0,
    isExercise: true, exerciseType: 'cardio'
  },
  {
    id: 'sw-flip', name: 'Flip Turn', icon: '🌀', category: 'swimming',
    tier: 'intermediate', description: 'Tumble turn — efficient wall-to-wall transition.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'moderate', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'sw-stream', name: 'Streamline Push', icon: '➡️', category: 'swimming',
    tier: 'basic', description: 'Tight streamline off the wall — minimises drag.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 3, willpowerRegen: 0,
    isExercise: true, exerciseType: 'technique'
  },
  {
    id: 'sw-tread', name: 'Treading Water', icon: '🌊', category: 'swimming',
    tier: 'basic', description: 'Vertical flutter kick — endurance and water safety.',
    activityKey: 'swimming', type: 'workout', animation: 'Push Up',
    intensity: 'routine', willpowerCost: 5, willpowerRegen: 0,
    isExercise: true, exerciseType: 'cardio'
  },

  // ═══════════════════════════════════════════════════════════ GUITAR ══
  {
    id: 'gt-openchords', name: 'Open Chords', icon: '🎵', category: 'guitar',
    tier: 'basic', description: 'G, C, D, Em, Am — essential open-string chord shapes.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'routine', willpowerCost: 5, willpowerRegen: 0
  },
  {
    id: 'gt-power', name: 'Power Chords', icon: '⚡', category: 'guitar',
    tier: 'basic', description: '5th chord (root + 5th) — used in rock and metal.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'routine', willpowerCost: 4, willpowerRegen: 0
  },
  {
    id: 'gt-strum', name: 'Strumming', icon: '🎸', category: 'guitar',
    tier: 'basic', description: 'Down-up strum rhythms — rhythmic accompaniment.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'routine', willpowerCost: 4, willpowerRegen: 0
  },
  {
    id: 'gt-penta', name: 'Pentatonic Scale', icon: '🎼', category: 'guitar',
    tier: 'basic', description: '5-note scale — foundation of rock and blues soloing.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0
  },
  {
    id: 'gt-major', name: 'Major Scale', icon: '☀️', category: 'guitar',
    tier: 'intermediate', description: 'Diatonic major — foundation of Western melody.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0
  },
  {
    id: 'gt-minor', name: 'Natural Minor', icon: '🌙', category: 'guitar',
    tier: 'intermediate', description: 'Aeolian mode — dark, emotive melodic foundation.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0
  },
  {
    id: 'gt-barre', name: 'Barre Chords', icon: '🤚', category: 'guitar',
    tier: 'intermediate', description: 'Full-index barre shapes — moveable chord voicings.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 8, willpowerRegen: 0
  },
  {
    id: 'gt-finger', name: 'Fingerpicking', icon: '🖐️', category: 'guitar',
    tier: 'intermediate', description: 'PIMA technique — classical and folk accompaniment.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 8, willpowerRegen: 0
  },
  {
    id: 'gt-1645', name: 'I–V–vi–IV', icon: '🎹', category: 'guitar',
    tier: 'intermediate', description: 'Pop progression C-G-Am-F — foundation of 1,000 songs.',
    activityKey: 'songwriting', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0
  },
  {
    id: 'gt-blues', name: '12-Bar Blues', icon: '🎷', category: 'guitar',
    tier: 'intermediate', description: 'Standard I-IV-V form in 12 bars.',
    activityKey: 'songwriting', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 7, willpowerRegen: 0
  },
  {
    id: 'gt-hammer', name: 'Hammer-Ons', icon: '🔨', category: 'guitar',
    tier: 'intermediate', description: 'Legato technique — fluid notes without picking.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 6, willpowerRegen: 0
  },
  {
    id: 'gt-dorian', name: 'Dorian Mode', icon: '🎶', category: 'guitar',
    tier: 'advanced', description: 'Natural minor with raised 6th — jazz and rock modal sound.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'complex', willpowerCost: 10, willpowerRegen: 0
  },
  {
    id: 'gt-vibrato', name: 'Vibrato', icon: '〰️', category: 'guitar',
    tier: 'advanced', description: 'Controlled pitch oscillation — expressive soloing technique.',
    activityKey: 'music-practice', type: 'artist', animation: 'Thinking',
    intensity: 'complex', willpowerCost: 8, willpowerRegen: 0
  },

  // ════════════════════════════════════════════════════════════ CODING ══
  {
    id: 'dev-feat', name: 'Feature Dev', icon: '💻', category: 'coding',
    tier: 'basic', description: 'Standard feature implementation — the daily work.',
    activityKey: 'coding-routine', type: 'coding', animation: 'Typing',
    intensity: 'routine', willpowerCost: 10, willpowerRegen: 0
  },
  {
    id: 'dev-debug', name: 'Debugging', icon: '🔍', category: 'coding',
    tier: 'basic', description: 'Systematic investigation and root-cause analysis.',
    activityKey: 'coding-complex', type: 'coding', animation: 'Thinking',
    intensity: 'complex', willpowerCost: 15, willpowerRegen: 0
  },
  {
    id: 'dev-arch', name: 'Architecture', icon: '🏛️', category: 'coding',
    tier: 'advanced', description: 'System design and high-level architectural decisions.',
    activityKey: 'coding-architecture', type: 'coding', animation: 'Thinking',
    intensity: 'complex', willpowerCost: 20, willpowerRegen: 0
  },
  {
    id: 'dev-review', name: 'Code Review', icon: '👁️', category: 'coding',
    tier: 'basic', description: 'Thorough PR review — improve team code quality.',
    activityKey: 'code-review-doing', type: 'coding', animation: 'Examining',
    intensity: 'moderate', willpowerCost: 10, willpowerRegen: 0
  },
  {
    id: 'dev-learn', name: 'Learning Tech', icon: '📚', category: 'coding',
    tier: 'intermediate', description: 'Deep-dive into new technology or framework.',
    activityKey: 'learning-tech', type: 'coding', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 12, willpowerRegen: 0
  },
  {
    id: 'dev-meeting', name: 'Active Meeting', icon: '🗣️', category: 'coding',
    tier: 'basic', description: 'Engaged meeting — presenting, problem solving.',
    activityKey: 'meetings-active', type: 'coding', animation: 'Thinking',
    intensity: 'routine', willpowerCost: 5, willpowerRegen: 0
  },

  // ═══════════════════════════════════════════════════════════════ SAGE ══
  {
    id: 'sage-prayer', name: 'Morning Prayer', icon: '🙏', category: 'sage',
    tier: 'basic', description: 'Wake Up With God — foundation of the day.',
    activityKey: 'prayer-routine', type: 'prayer', animation: 'Praying',
    intensity: 'routine', willpowerCost: 0, willpowerRegen: 5
  },
  {
    id: 'sage-bible', name: 'Bible Study', icon: '📖', category: 'sage',
    tier: 'basic', description: 'Deep scripture study and theological reflection.',
    activityKey: 'bible-study', type: 'prayer', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 0, willpowerRegen: 8
  },
  {
    id: 'sage-sermon', name: 'Sermon Study', icon: '🕊️', category: 'sage',
    tier: 'intermediate', description: 'Study or prepare a sermon or teaching.',
    activityKey: 'sermon', type: 'prayer', animation: 'Thinking',
    intensity: 'moderate', willpowerCost: 0, willpowerRegen: 10
  },
  {
    id: 'sage-warfare', name: 'Spiritual Warfare', icon: '⚔️', category: 'sage',
    tier: 'advanced', description: 'Prayer, fasting, disciplines — warfare against flesh.',
    activityKey: 'spiritual-warfare', type: 'prayer', animation: 'Praying',
    intensity: 'complex', willpowerCost: 0, willpowerRegen: 15
  },
];

// ─── LOOKUP MAP ──────────────────────────────────────────────────────────────

export const SKILL_MAP = new Map<string, Skill>(
  ALL_SKILLS.map(s => [s.id, s])
);

// ─── DEFAULT UNLOCKED SKILLS ─────────────────────────────────────────────────
// Unlock = user has practiced this technique at least once in a real session.
// Everything else starts grayed out (locked).

export const DEFAULT_UNLOCKED: string[] = [
  // Utility — always available
  'hydrate', 'deep-focus', 'log-day',
  // RedTeam — confirmed practiced in labs
  'rt-xss', 'rt-sqli',
  // Coding — professional tools (all active)
  'dev-feat', 'dev-debug', 'dev-review', 'dev-learn', 'dev-meeting',
  // Sage
  'sage-prayer', 'sage-bible',
];

// ─── SKILL BARS ──────────────────────────────────────────────────────────────

export const SKILL_BARS: SkillBar[] = [
  {
    id: 'utility',
    name: 'Utility',
    icon: '⚔️',
    colorClass: 'bar-utility',
    skills: ['hydrate', 'deep-focus', 'log-day'],
  },
  {
    id: 'redteam',
    name: 'RedTeam',
    icon: '🛡️',
    colorClass: 'bar-redteam',
    skills: [
      'rt-xss', 'rt-sqli', 'rt-idor', 'rt-csrf', 'rt-path',
      'rt-ssrf', 'rt-cmdi', 'rt-xxe', 'rt-auth',
      'rt-jwt', 'rt-upload', 'rt-bizlogic', 'rt-privesc',
    ],
  },
  {
    id: 'mma',
    name: 'MMA',
    icon: '🥊',
    colorClass: 'bar-mma',
    skills: [
      'mma-jab', 'mma-cross', 'mma-hook', 'mma-uppercut', 'mma-bodyhook',
      'mma-elbow', 'mma-kick', 'mma-knee',
      'mma-sltd', 'mma-dltd',
      'mma-rnc', 'mma-guillotine', 'mma-kimura', 'mma-armbar', 'mma-triangle',
    ],
  },
  {
    id: 'strength',
    name: 'Strength',
    icon: '🏋️',
    colorClass: 'bar-strength',
    skills: [
      'str-bench', 'str-incbench', 'str-deadlift', 'str-rdl', 'str-squat',
      'str-pullup', 'str-row', 'str-ohp',
      'str-curl', 'str-tripdwn', 'str-latpd', 'str-cablerow',
      'str-hipt', 'str-facepull', 'str-dip',
    ],
  },
  {
    id: 'swimming',
    name: 'Swimming',
    icon: '🏊',
    colorClass: 'bar-swimming',
    skills: [
      'sw-float', 'sw-seal', 'sw-stream', 'sw-tread',
      'sw-free', 'sw-back', 'sw-breast', 'sw-butterfly',
      'sw-flip',
    ],
  },
  {
    id: 'guitar',
    name: 'Guitar',
    icon: '🎸',
    colorClass: 'bar-guitar',
    skills: [
      'gt-openchords', 'gt-power', 'gt-strum',
      'gt-penta', 'gt-major', 'gt-minor',
      'gt-barre', 'gt-finger',
      'gt-1645', 'gt-blues',
      'gt-hammer', 'gt-dorian', 'gt-vibrato',
    ],
  },
  {
    id: 'coding',
    name: 'Coding',
    icon: '💻',
    colorClass: 'bar-coding',
    skills: ['dev-feat', 'dev-debug', 'dev-arch', 'dev-review', 'dev-learn', 'dev-meeting'],
  },
  {
    id: 'sage',
    name: 'Sage',
    icon: '🙏',
    colorClass: 'bar-sage',
    skills: ['sage-prayer', 'sage-bible', 'sage-sermon', 'sage-warfare'],
  },
];

// ─── COMBOS ──────────────────────────────────────────────────────────────────

export const COMBOS: ComboDefinition[] = [
  // ── MMA Striking Combos ──
  {
    id: 'combo-1-2',
    name: '1-2',
    description: 'Jab → Cross — classic boxing fundamental',
    skillIds: ['mma-jab', 'mma-cross'],
    bonusXp: 5,
    category: 'mma',
  },
  {
    id: 'combo-1-2-3',
    name: '1-2-3',
    description: 'Jab → Cross → Hook — power finisher',
    skillIds: ['mma-jab', 'mma-cross', 'mma-hook'],
    bonusXp: 10,
    category: 'mma',
  },
  {
    id: 'combo-1-1-2',
    name: '1-1-2',
    description: 'Jab → Jab → Cross — double jab setup',
    skillIds: ['mma-jab', 'mma-jab', 'mma-cross'],
    bonusXp: 8,
    category: 'mma',
  },
  {
    id: 'combo-1-2-3-body-3',
    name: '1-2-3-Body-3',
    description: 'Jab → Cross → Hook → Body Hook — level change',
    skillIds: ['mma-jab', 'mma-cross', 'mma-hook', 'mma-bodyhook'],
    bonusXp: 15,
    category: 'mma',
  },
  // ── OWASP Exploit Chains ──
  {
    id: 'chain-xss-csrf',
    name: 'XSS → CSRF Chain',
    description: 'Steal session via XSS then forge authenticated request',
    skillIds: ['rt-xss', 'rt-csrf'],
    bonusXp: 15,
    category: 'redteam',
  },
  {
    id: 'chain-sqli-auth',
    name: 'SQLi → Auth Bypass',
    description: 'Dump credentials via SQLi then bypass authentication',
    skillIds: ['rt-sqli', 'rt-auth'],
    bonusXp: 18,
    category: 'redteam',
  },
  {
    id: 'chain-ssrf-cmdi',
    name: 'SSRF → RCE',
    description: 'Scan internal services via SSRF then achieve RCE via command injection',
    skillIds: ['rt-ssrf', 'rt-cmdi'],
    bonusXp: 25,
    category: 'redteam',
  },
  // ── Guitar Progressions ──
  {
    id: 'prog-pop',
    name: 'Pop Song',
    description: 'Open Chords → Strumming → I-V-vi-IV — the 1,000 song foundation',
    skillIds: ['gt-openchords', 'gt-strum', 'gt-1645'],
    bonusXp: 12,
    category: 'guitar',
  },
  {
    id: 'prog-blues-solo',
    name: 'Blues Solo',
    description: '12-Bar Blues with Pentatonic lead line',
    skillIds: ['gt-blues', 'gt-penta'],
    bonusXp: 15,
    category: 'guitar',
  },
];
