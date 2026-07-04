/**
 * extract-icons.mjs
 *
 * Extracts game-icons.net SVGs for each skill in skill-tree.data.ts.
 * Source:  @iconify-json/game-icons (4123 icons)
 * Output:  src/assets/icons/[icon-name].svg
 *          src/assets/icons/skill-icon-map.json  (skill-id → filename)
 *
 * Run once:  node scripts/extract-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const iconifyPath = path.join(__dir, '../node_modules/@iconify-json/game-icons/icons.json');
const outDir      = path.join(__dir, '../src/assets/icons');

const data = JSON.parse(readFileSync(iconifyPath, 'utf8'));
const allIcons = data.icons;

// ── Skill → game-icon name mapping ───────────────────────────────────────
// Chosen to best represent each skill's theme from the 4123 available icons.
const SKILL_ICON_MAP = {
  // ── Utility ──────────────────────────────────────────────────────────
  'hydrate':          'water-drop',
  'deep-focus':       'brain',
  'log-day':          'open-book',

  // ── Red Team ─────────────────────────────────────────────────────────
  'rt-xss':           'fire-bomb',
  'rt-sqli':          'daggers',
  'rt-idor':          'key',
  'rt-csrf':          'fishing-hook',
  'rt-path':          'locked-door',
  'rt-ssrf':          'spider-web',
  'rt-cmdi':          'lightning-frequency',
  'rt-xxe':           'scroll-unfurled',
  'rt-auth':          'combination-lock',
  'rt-jwt':           'padlock',
  'rt-upload':        'cloud-upload',
  'rt-bizlogic':      'puzzle',
  'rt-privesc':       'star-key',

  // ── MMA ──────────────────────────────────────────────────────────────
  'mma-jab':          'punch',
  'mma-cross':        'fulguro-punch',
  'mma-hook':         'hook',
  'mma-uppercut':     'punch-blast',
  'mma-bodyhook':     'boxing-glove',
  'mma-elbow':        'forearm',
  'mma-kick':         'high-kick',
  'mma-knee':         'boot-kick',
  'mma-sltd':         'body-balance',
  'mma-dltd':         'weight-lifting-down',
  'mma-rnc':          'locked-chest',
  'mma-guillotine':   'hook-swords',
  'mma-kimura':       'arm-sling',
  'mma-armbar':       'arm',
  'mma-triangle':     'trident-shield',

  // ── Strength ─────────────────────────────────────────────────────────
  'str-bench':        'weight-lifting-up',
  'str-incbench':     'weight-lifting-up',
  'str-deadlift':     'weight',
  'str-rdl':          'weight-lifting-down',
  'str-squat':        'armor-cuisses',
  'str-pullup':       'daemon-pull',
  'str-row':          'gear-stick',
  'str-ohp':          'weight-lifting-up',
  'str-curl':         'arm',
  'str-tripdwn':      'weight-crush',
  'str-latpd':        'armor-downgrade',
  'str-cablerow':     'gear-stick-pattern',
  'str-hipt':         'armor-cuisses',
  'str-facepull':     'armor-punch',
  'str-dip':          'weight-lifting-down',

  // ── Swimming ─────────────────────────────────────────────────────────
  'sw-float':         'water-bottle',
  'sw-seal':          'wave-strike',
  'sw-free':          'water-splash',
  'sw-back':          'wave-crest',
  'sw-breast':        'water-polo',
  'sw-butterfly':     'big-wave',
  'sw-flip':          'whirlpool-shuriken',
  'sw-stream':        'water-mill',
  'sw-tread':         'waves',

  // ── Guitar ───────────────────────────────────────────────────────────
  'gt-openchords':    'musical-notes',
  'gt-power':         'guitar',
  'gt-strum':         'guitar-bass-head',
  'gt-penta':         'musical-score',
  'gt-major':         'music-spell',
  'gt-minor':         'musical-notes',
  'gt-barre':         'guitar-head',
  'gt-finger':        'piano-keys',
  'gt-1645':          'musical-keyboard',
  'gt-blues':         'bassoon',
  'gt-hammer':        'claw-hammer',
  'gt-dorian':        'music-spell',
  'gt-vibrato':       'sound-waves',

  // ── Coding ───────────────────────────────────────────────────────────
  'dev-feat':         'circuitry',
  'dev-debug':        'cyber-eye',
  'dev-arch':         'gears',
  'dev-review':       'brain-dump',
  'dev-learn':        'book-cover',
  'dev-meeting':      'microchip',

  // ── Sage ─────────────────────────────────────────────────────────────
  'sage-prayer':      'enlightenment',
  'sage-bible':       'book-aura',
  'sage-sermon':      'spell-book',
  'sage-warfare':     'crossed-swords',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function buildSvg(iconName) {
  const icon = allIcons[iconName];
  if (!icon) return null;
  const w = icon.width  ?? data.width  ?? 512;
  const h = icon.height ?? data.height ?? 512;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${icon.body}</svg>`;
}

// ── Main ──────────────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });

const written   = [];
const missing   = [];
const dedupMap  = {}; // icon-name → filename (avoid writing twice)

for (const [skillId, iconName] of Object.entries(SKILL_ICON_MAP)) {
  if (!allIcons[iconName]) {
    missing.push({ skillId, iconName });
    continue;
  }
  const filename = `${iconName}.svg`;
  if (!dedupMap[iconName]) {
    const svg = buildSvg(iconName);
    writeFileSync(path.join(outDir, filename), svg, 'utf8');
    dedupMap[iconName] = filename;
  }
  written.push({ skillId, iconName, filename });
}

// Write the skill-icon mapping JSON so Angular can reference it
const skillMap = {};
for (const { skillId, iconName } of written) {
  skillMap[skillId] = `${iconName}.svg`;
}
writeFileSync(
  path.join(outDir, 'skill-icon-map.json'),
  JSON.stringify(skillMap, null, 2),
  'utf8'
);

console.log(`\n✅ Extracted ${Object.keys(dedupMap).length} unique SVG files → src/assets/icons/`);
console.log(`✅ Wrote skill-icon-map.json  (${Object.keys(skillMap).length} skill mappings)\n`);

if (missing.length) {
  console.warn('⚠️  Missing icons (check spelling):');
  missing.forEach(({ skillId, iconName }) =>
    console.warn(`   ${skillId.padEnd(20)} → "${iconName}" NOT found`)
  );
}
