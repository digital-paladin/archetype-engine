/**
 * Canonical catalog copied into inventory_items for each user.
 * The same rows are seeded in supabase/migrations/014_acquisition_quests_and_inventory.sql.
 * A unit test fails if a slug or name here is missing from that migration.
 */

export type InventoryItemType = 'consumable' | 'equipment';
export type InventoryCategory =
  | 'steel-supplement'
  | 'recovery-gear'
  | 'armor'
  | 'weapon'
  | 'mount'
  | 'tech-hardware'
  | 'survivalist';
export type StockStatus = 'stocked' | 'low' | 'needed';
export type ItemPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export interface InventoryDefault {
  id: string;
  name: string;
  type: InventoryItemType;
  category: InventoryCategory;
  icon: string;
  unit: string;
  description: string;
  equipped?: boolean;
  level?: number;
  stockStatus?: StockStatus;
  monthlyCost?: string;
  priority?: ItemPriority;
}

export const INVENTORY_DEFAULTS: InventoryDefault[] = [
  { id: 'whey-protein', name: 'Whey Protein Powder', type: 'consumable', category: 'steel-supplement', icon: '🥤', unit: 'scoop', description: 'Post-workout recovery — ~30g protein per scoop.', monthlyCost: '$40–60', priority: 'HIGH', stockStatus: 'stocked' },
  { id: 'pre-workout', name: 'Pre-Workout Blend', type: 'consumable', category: 'steel-supplement', icon: '⚡', unit: 'scoop', description: 'Energy for early-morning training sessions.', monthlyCost: '$35–50', priority: 'HIGH', stockStatus: 'stocked' },
  { id: 'intra-workout', name: 'Intra-Workout Mix', type: 'consumable', category: 'steel-supplement', icon: '💧', unit: 'scoop', description: 'Peri-workout hydration and pump support.', monthlyCost: '$35–50', priority: 'HIGH', stockStatus: 'stocked' },
  { id: 'sleep-support', name: 'Sleep Support Blend', type: 'consumable', category: 'steel-supplement', icon: '🌙', unit: 'serving', description: 'Sleep quality support — aids XP consolidation recovery.', monthlyCost: '$35–50', priority: 'HIGH', stockStatus: 'stocked' },
  { id: 'daily-multi', name: 'Daily Multivitamin', type: 'consumable', category: 'steel-supplement', icon: '💊', unit: 'serving', description: 'Daily micronutrient baseline.', monthlyCost: '$25–40', priority: 'MEDIUM', stockStatus: 'stocked' },
  { id: 'creatine', name: 'Creatine Monohydrate', type: 'consumable', category: 'steel-supplement', icon: '🔬', unit: 'gram', description: 'Strength support — 5g daily.', monthlyCost: '$10–15', priority: 'MEDIUM', stockStatus: 'stocked' },
  { id: 'energy-drink', name: 'Energy Drink', type: 'consumable', category: 'steel-supplement', icon: '🥤', unit: 'can', description: 'Caffeinated on-the-go energy (~150mg).', monthlyCost: '$30–45', priority: 'MEDIUM', stockStatus: 'low' },
  { id: 'energy-backup', name: 'Backup Energy Drink', type: 'consumable', category: 'steel-supplement', icon: '⚡', unit: 'can', description: 'Secondary energy source. Use sparingly.', monthlyCost: '$30–45', priority: 'LOW', stockStatus: 'needed' },
  { id: 'knee-sleeve', name: 'Knee Sleeve', type: 'equipment', category: 'recovery-gear', icon: '🦵', unit: 'piece', description: 'Compression support for joint stability. 6–12 month cycle.', monthlyCost: '$20–40', priority: 'HIGH', stockStatus: 'stocked', equipped: false },
  { id: 'massage-gun', name: 'Massage Gun', type: 'equipment', category: 'recovery-gear', icon: '🔧', unit: 'piece', description: 'Daily muscle recovery & trigger point release. Theragun / Hyperice.', monthlyCost: '$150–300', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'foam-roller', name: 'Foam Roller', type: 'equipment', category: 'recovery-gear', icon: '🟫', unit: 'piece', description: 'Self-myofascial release. 2–3 year cycle.', monthlyCost: '$20–40', priority: 'MEDIUM', stockStatus: 'needed' },
  { id: 'ice-packs', name: 'Ice Packs', type: 'equipment', category: 'recovery-gear', icon: '🧊', unit: 'set', description: 'Reusable. Critical for RICE protocol — acute injury treatment.', monthlyCost: '$10–20', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'kt-tape', name: 'KT Tape', type: 'equipment', category: 'recovery-gear', icon: '🩹', unit: 'roll', description: 'Preventive taping & injury support. Replenish as needed.', monthlyCost: '$10–15', priority: 'MEDIUM', stockStatus: 'low' },
  { id: 'ibuprofen', name: 'Ibuprofen', type: 'consumable', category: 'recovery-gear', icon: '💊', unit: 'tablet', description: 'Anti-inflammatory. Max 2–3x/week to avoid masking injury signals.', monthlyCost: '$10–15', priority: 'HIGH', stockStatus: 'stocked' },
  { id: 'biofreeze', name: 'Biofreeze', type: 'consumable', category: 'recovery-gear', icon: '🧴', unit: 'use', description: 'Topical pain relief. 2–3 month cycle.', monthlyCost: '$8–12', priority: 'MEDIUM', stockStatus: 'low' },
  { id: 'epsom-salt', name: 'Epsom Salt', type: 'consumable', category: 'recovery-gear', icon: '🛁', unit: 'cup', description: 'Recovery baths 2x/week during injury recovery.', monthlyCost: '$5–10', priority: 'LOW', stockStatus: 'needed' },
  { id: 'first-aid-kit', name: 'First Aid Kit', type: 'equipment', category: 'recovery-gear', icon: '🏥', unit: 'kit', description: 'Wilderness-grade. One-time purchase + refills. Priority Phase 3+.', monthlyCost: '$30–60', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'belt-of-truth', name: 'Belt of Truth', type: 'equipment', category: 'armor', icon: '🔗', unit: 'piece', description: 'Ephesians 6:14 — Truth holds everything together', equipped: false, level: 1 },
  { id: 'breastplate-righteousness', name: 'Breastplate of Righteousness', type: 'equipment', category: 'armor', icon: '🛡️', unit: 'piece', description: 'Ephesians 6:14 — Protects the heart', equipped: false, level: 10 },
  { id: 'boots-of-peace', name: 'Boots of Peace', type: 'equipment', category: 'armor', icon: '👢', unit: 'piece', description: 'Ephesians 6:15 — Readiness from the gospel', equipped: false, level: 1 },
  { id: 'shield-of-faith', name: 'Shield of Faith', type: 'equipment', category: 'armor', icon: '🛡️', unit: 'piece', description: 'Ephesians 6:16 — Extinguishes flaming arrows', equipped: false, level: 20 },
  { id: 'helmet-of-salvation', name: 'Helmet of Salvation', type: 'equipment', category: 'armor', icon: '⛑️', unit: 'piece', description: 'Ephesians 6:17 — Protects the mind', equipped: false, level: 15 },
  { id: 'sword-of-spirit', name: 'Sword of the Spirit', type: 'equipment', category: 'armor', icon: '⚔️', unit: 'piece', description: 'Ephesians 6:17 — The Word of God', equipped: false, level: 25 },
  { id: 'hk-cc9', name: 'Compact 9mm Handgun', type: 'equipment', category: 'weapon', icon: '🔫', unit: 'piece', description: 'Primary conceal-carry sidearm. Semi-auto 9mm. Range + home defense training.', monthlyCost: '$600–700', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'ammo-9mm-range', name: '9mm Ammo (Range)', type: 'consumable', category: 'weapon', icon: '🎯', unit: 'rounds', description: 'Range practice — target 200 rds/month (Phase 2). Hollow-point carry rounds separate.', monthlyCost: '$60–80', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'personal-vehicle', name: 'Personal Vehicle', type: 'equipment', category: 'mount', icon: '🚗', unit: 'vehicle', description: 'Primary transportation. Maintain: oil changes every 5k mi, tire rotations, insurance current.', priority: 'HIGH', stockStatus: 'stocked', equipped: true },
  { id: 'dev-laptop', name: 'Development Laptop', type: 'equipment', category: 'tech-hardware', icon: '💻', unit: 'device', description: 'Primary workstation for software development and security practice. Keep OS & tools updated.', priority: 'HIGH', stockStatus: 'stocked', equipped: true },
  { id: 'kali-vm', name: 'Kali Linux VM', type: 'equipment', category: 'tech-hardware', icon: '🐉', unit: 'install', description: 'Attack OS for red team practice. VirtualBox/VMware. Core lab environment.', priority: 'HIGH', stockStatus: 'stocked' },
  { id: 'burpsuite-pro', name: 'Burp Suite Pro', type: 'consumable', category: 'tech-hardware', icon: '🕷️', unit: 'license/yr', description: 'Web app pen testing — OWASP Top 10 scanning, proxy, intruder. OSCP prep essential.', monthlyCost: '$449/yr', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'htb-vip', name: 'HackTheBox VIP+', type: 'consumable', category: 'tech-hardware', icon: '🎯', unit: 'subscription', description: 'Active machine access for red team skill building. OSCP practice lab.', monthlyCost: '$14/mo', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'oscp-cert', name: 'OSCP Certification', type: 'consumable', category: 'tech-hardware', icon: '🎓', unit: 'course', description: 'OffSec Certified Professional — Phase 2/3 target. $1,499 exam + 90-day lab.', monthlyCost: '$50/mo', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-tent', name: 'MSR Hubba Hubba Tent', type: 'equipment', category: 'survivalist', icon: '⛺', unit: 'piece', description: '4-season 2-person tent. Core Phase 3 Dec 2026 purchase.', monthlyCost: '$450–550', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-sleep-bag', name: 'Marmot 20°F Sleeping Bag', type: 'equipment', category: 'survivalist', icon: '🛏️', unit: 'piece', description: '20°F rating. Cold-weather camping foundation. Dec 2026.', monthlyCost: '$180–220', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-sleep-pad', name: 'Therm-a-Rest NeoAir Pad', type: 'equipment', category: 'survivalist', icon: '🏕️', unit: 'piece', description: 'Insulated sleeping pad. Critical for cold ground insulation.', monthlyCost: '$150–200', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-pack', name: 'Osprey Atmos AG 65L', type: 'equipment', category: 'survivalist', icon: '🎒', unit: 'piece', description: '65L backpacking pack. Base layer for all wilderness trips.', monthlyCost: '$250–300', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-water-filter', name: 'Sawyer Squeeze Filter', type: 'equipment', category: 'survivalist', icon: '💧', unit: 'piece', description: 'Water filtration — removes 99.9999% bacteria/protozoa. No expiration.', monthlyCost: '$30–50', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-headlamp', name: 'Petzl Actik Core Headlamp', type: 'equipment', category: 'survivalist', icon: '🔦', unit: 'piece', description: 'Rechargeable headlamp 450 lm. Essential for camp navigation.', monthlyCost: '$60–80', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-fire-kit', name: 'Fire Starter Kit', type: 'equipment', category: 'survivalist', icon: '🔥', unit: 'kit', description: 'Ferro rod + tinder. Redundant fire source — do not rely on lighter only.', monthlyCost: '$20–30', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-multitool', name: 'Leatherman Wave+', type: 'equipment', category: 'survivalist', icon: '🔧', unit: 'piece', description: '18-tool multi-tool. EDC + camp utility.', monthlyCost: '$100–120', priority: 'MEDIUM', stockStatus: 'needed' },
  { id: 'bs-stove', name: 'MSR PocketRocket 2 Stove', type: 'equipment', category: 'survivalist', icon: '🍳', unit: 'piece', description: 'Ultralight camp stove + fuel canister. Boils 1L in 3.5 min.', monthlyCost: '$45–60', priority: 'MEDIUM', stockStatus: 'needed' },
  { id: 'bs-cookset', name: 'MSR Trail Lite Cookset', type: 'equipment', category: 'survivalist', icon: '🥘', unit: 'set', description: '2-pot cook set. 1L + 1.5L anodized aluminum. Packs inside pack.', monthlyCost: '$60–80', priority: 'MEDIUM', stockStatus: 'needed' },
  { id: 'bs-sat-comm', name: 'Garmin inReach Mini', type: 'equipment', category: 'survivalist', icon: '📡', unit: 'piece', description: 'Two-way satellite communicator + SOS. Phase 4 purchase Jun 2027.', monthlyCost: '$350–400', priority: 'HIGH', stockStatus: 'needed' },
  { id: 'bs-trekpoles', name: 'Trekking Poles', type: 'equipment', category: 'survivalist', icon: '🥍', unit: 'pair', description: 'Stability on rough terrain. Reduces knee impact ~25%. Phase 4.', monthlyCost: '$80–150', priority: 'MEDIUM', stockStatus: 'needed' },
];
