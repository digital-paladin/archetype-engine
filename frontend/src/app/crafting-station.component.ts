import { Component, signal, computed, OnInit, inject } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../environments/environment';

// ── Types ─────────────────────────────────────────────────────────────────────

type StationId  = 'wilderness' | 'dev';
type DevSubId   = 'enterprise' | 'char-prog' | 'quantconnect' | 'redteam';
type Difficulty = 'novice' | 'adept' | 'expert' | 'master';
type CraftStatus = 'available' | 'in-progress' | 'completed';

interface Requirement { icon: string; label: string; }

interface Recipe {
  id: string;
  name: string;
  lore: string;
  category: StationId;
  sub?: DevSubId;
  difficulty: Difficulty;
  requirements: Requirement[];
  outputName: string;
  outputDesc: string;
  xpReward: number;
  craftTime: string;
  /** Optional: locks this recipe until the player reaches the specified class level */
  requiredClassLevel?: { class: string; level: number };
}

interface CraftEntry {
  recipeId: string;
  status: CraftStatus;
  startedAt: string;
  completedAt?: string;
}

// ── Recipe Library ─────────────────────────────────────────────────────────────

const RECIPES: Recipe[] = [

  // ── WILDERNESS FORGE ─────────────────────────────────────────────────────────

  {
    id: 'w-fire',
    name: 'Primitive Fire Kit',
    lore: 'Master fire before batteries exist. Bow drill discipline, ferro rod reliability, char cloth as tinder insurance — three methods, zero excuses.',
    category: 'wilderness', difficulty: 'adept',
    requirements: [
      { icon: '🪵', label: 'Dry hardwood spindle + hearthboard' },
      { icon: '🔧', label: 'Ferro rod + striker' },
      { icon: '⏱', label: '1-2 sessions of practice' },
    ],
    outputName: 'Fire Mastery Badge',
    outputDesc: 'Proven fire-starting in 3 methods. +5% Survivalist XP on outdoor sessions.',
    xpReward: 150, craftTime: '2 sessions',
  },
  {
    id: 'w-cordage',
    name: 'Cordage & Lashing Kit',
    lore: 'Paracord, bank line, and tarred twine — the trinity of field cordage. Builds traps, shelters, and keeps boots laced under pressure.',
    category: 'wilderness', difficulty: 'novice',
    requirements: [
      { icon: '🧵', label: '100ft paracord + 50ft bank line' },
      { icon: '📚', label: 'Square lash, timber hitch, trucker hitch' },
      { icon: '⏱', label: '1 evening of knot drills' },
    ],
    outputName: 'Field Rigger Kit',
    outputDesc: 'Comprehensive cordage loadout. Unlocks trapping + shelter crafting recipes.',
    xpReward: 80, craftTime: '1 evening',
  },
  {
    id: 'w-shelter',
    name: 'Emergency Debris Shelter',
    lore: 'A debris hut retains body heat like no commercial solution. Arm-length door, ribpole, and knee-deep leaf insulation — primitive engineering.',
    category: 'wilderness', difficulty: 'adept',
    requirements: [
      { icon: '🌲', label: 'Wooded area with fallen debris' },
      { icon: '📐', label: 'Learn debris hut geometry (ridgepole, ribs, thatch)' },
      { icon: '⏱', label: '2-3hrs hands-on build' },
    ],
    outputName: 'Shelter Competency',
    outputDesc: 'Field-tested debris hut construction. +10% Survivalist XP — cold weather sessions.',
    xpReward: 200, craftTime: '3hrs',
  },
  {
    id: 'w-water',
    name: 'Water Procurement System',
    lore: 'The 3-day rule is unforgiving. Sawyer filter + purification backup + knowledge of natural sources = never going thirsty in any environment.',
    category: 'wilderness', difficulty: 'novice',
    requirements: [
      { icon: '🫙', label: 'Sawyer Squeeze filter + 2× 32oz Nalgene' },
      { icon: '💊', label: 'Aquatabs or Potable Aqua tabs (backup)' },
      { icon: '📚', label: 'Solar still + seep well construction' },
    ],
    outputName: 'Hydration Protocol',
    outputDesc: 'Multi-method water procurement. Never go thirsty — field or grid-down.',
    xpReward: 120, craftTime: '1 session',
  },
  {
    id: 'w-forage',
    name: 'Regional Foraging Reference',
    lore: 'Know what you can eat BEFORE hunger clouds judgment. The deadly lookalike problem kills more than starvation. Learn the plants, then trust them.',
    category: 'wilderness', difficulty: 'novice',
    requirements: [
      { icon: '📗', label: 'Regional field guide (Tom Brown Jr / Sam Thayer)' },
      { icon: '🖊', label: 'Compile top 15 edibles + their toxic lookalikes' },
      { icon: '⏱', label: '2-3hrs research + note compilation' },
    ],
    outputName: "Forager's Primer",
    outputDesc: '15-plant regional ID sheet. Unlocks foraging XP multiplier on outdoor sessions.',
    xpReward: 100, craftTime: '3hrs research',
  },
  {
    id: 'w-ifak',
    name: 'IFAK Trauma Kit',
    lore: 'You cannot stop bleeding from someone else while you bleed out. Tourniquet application, chest seals, wound packing — train on yourself first.',
    category: 'wilderness', difficulty: 'expert',
    requirements: [
      { icon: '🩹', label: 'CAT tourniquet + HyFin chest seals' },
      { icon: '🩸', label: 'QuikClot / CombatGauze + Israeli bandage' },
      { icon: '🎓', label: 'Stop The Bleed or equivalent trauma course' },
    ],
    outputName: 'Medical Loadout',
    outputDesc: 'Staged IFAK with verified skills. +15% Survivalist XP on medical training.',
    xpReward: 300, craftTime: '1 weekend',
  },
  {
    id: 'w-nav',
    name: 'Orienteering Navigation Kit',
    lore: 'GPS batteries die. Maps and compasses do not. Declination, terrain association, triangulation — the land itself becomes your interface.',
    category: 'wilderness', difficulty: 'adept',
    requirements: [
      { icon: '🧭', label: 'Suunto A-10 or Silva Ranger baseplate compass' },
      { icon: '🗺', label: 'USGS 1:24,000 topo map for local area' },
      { icon: '📚', label: 'Practice triangulation + terrain association' },
    ],
    outputName: 'Land Navigator',
    outputDesc: 'Proven orienteering skills. Unlocks wilderness expedition tracking recipes.',
    xpReward: 180, craftTime: '2 sessions',
  },
  {
    id: 'w-signal',
    name: 'Emergency Signal Kit',
    lore: 'Being found is often harder than surviving. Improvised signals fail. Pre-built, tested signals save lives — and SAR operations time.',
    category: 'wilderness', difficulty: 'novice',
    requirements: [
      { icon: '🪞', label: 'Signal mirror (glass, not plastic)' },
      { icon: '📯', label: 'Fox 40 pealess whistle + 550 cord lanyard' },
      { icon: '🟧', label: 'VS-17 signal panel + Cyalume chemlight sticks' },
    ],
    outputName: "Signaler's Kit",
    outputDesc: 'Ground-to-air + audible + night-visible signal suite. SERE preparedness unlock.',
    xpReward: 90, craftTime: '1 session',
  },

  // ── DEV WORKSHOP: Enterprise ──────────────────────────────────────────────────

  {
    id: 'enterprise-va-visibility',
    name: 'Grid Column Visibility System',
    lore: 'Data-driven show/hide for dynamic grid columns. Three-layer coordination: column def → grid API → dialog state.',
    category: 'dev', sub: 'enterprise', difficulty: 'expert',
    requirements: [
      { icon: '📊', label: 'Analyze rowData for max VA section per quantity' },
      { icon: '⚙', label: 'Three-layer: ColDef hide + setColumnVisible() + dialog sync' },
      { icon: '🧪', label: 'Karma unit tests for visibility logic' },
    ],
    outputName: 'VA Visibility System',
    outputDesc: 'Data-driven 3-layer column visibility. Deployed to DEV/QA. Reusable AG Grid pattern.',
    xpReward: 250, craftTime: '1 sprint',
  },
  {
    id: 'enterprise-resale-refresh',
    name: 'API Rate-Limit Refresh',
    lore: 'Daily rate limit on resale API calls — backend cooldown + frontend state + DB migration. The classic fullstack trifecta.',
    category: 'dev', sub: 'enterprise', difficulty: 'expert',
    requirements: [
      { icon: '☕', label: 'Spring cooldown service + @Scheduled reset' },
      { icon: '⚡', label: 'Angular button state + NGXS action' },
      { icon: '🗄', label: 'Flyway V_*.sql + U_*.sql rollback migration' },
    ],
    outputName: 'Resale Refresh Feature',
    outputDesc: 'Rate-limited resale refresh shipped to DEV/QA/UAT. Full backend + frontend + DB.',
    xpReward: 280, craftTime: '1 sprint',
  },
  {
    id: 'enterprise-cam-routing',
    name: 'SPA Routing Module Fix',
    lore: 'Routing module incompatibility between environments exposed by a merge conflict. The fix was surgical — the lesson permanent.',
    category: 'dev', sub: 'enterprise', difficulty: 'adept',
    requirements: [
      { icon: '🔍', label: 'Diff DEV vs UAT routing module configs' },
      { icon: '🍒', label: 'Cherry-pick conflict resolution + force-push fix' },
      { icon: '🧪', label: 'UAT regression test for all CAM navigation paths' },
    ],
    outputName: 'Routing Patch',
    outputDesc: 'Stable CAM navigation in DEV/QA/UAT. Cherry-pick methodology documented.',
    xpReward: 150, craftTime: '2 days',
  },
  {
    id: 'enterprise-delegates',
    name: 'Custom Grid Cell Renderer',
    lore: 'Remove default cell editor to stop the grid from fighting your custom popover. The double-popover bug: a lesson in framework defaults.',
    category: 'dev', sub: 'enterprise', difficulty: 'expert',
    requirements: [
      { icon: '📊', label: 'Remove cellEditor + cellEditorParams from ColDef' },
      { icon: '🖱', label: 'Custom cellRenderer handles click → popover' },
      { icon: '🧪', label: 'Verify: single popover, no AG Grid editor conflict' },
    ],
    outputName: 'Delegate Popover',
    outputDesc: 'Clean custom cell renderer with no AG Grid editor conflict. Pattern documented.',
    xpReward: 200, craftTime: '1 sprint',
  },
  {
    id: 'enterprise-jpa-spec',
    name: 'JPA Specification Refactor',
    lore: 'Hierarchical predicate logic — direct assignment first, then role-based access. Over-permissive OR combining incompatible rules is the silent killer of correctness.',
    category: 'dev', sub: 'enterprise', difficulty: 'expert',
    requirements: [
      { icon: '☕', label: 'Understand CriteriaBuilder predicate composition' },
      { icon: '🔬', label: 'Enable Hibernate SQL logging for query analysis' },
      { icon: '🧪', label: 'JUnit tests with in-memory H2 for Specification validation' },
    ],
    outputName: 'JPA Query Blueprint',
    outputDesc: 'Reusable Specification<T> pattern library. Hierarchical OR logic documented.',
    xpReward: 220, craftTime: '3 days',
  },

  // ── DEV WORKSHOP: CHAR-PROG ───────────────────────────────────────────────────

  {
    id: 'cp-body-status',
    name: 'Phase 8: Body Status Panel',
    lore: 'SVG body silhouette. 26 interactive injury zones. Severity-coded colors. Recovery bars. XP penalty integration. ESO gold palette throughout.',
    category: 'dev', sub: 'char-prog', difficulty: 'master',
    requirements: [
      { icon: '🎨', label: 'SVG viewBox 0 0 100 100 with decorative silhouette' },
      { icon: '⚡', label: 'getZoneFill() / getZoneStroke() severity color mapping' },
      { icon: '🧪', label: '345/345 Karma tests passing after implementation' },
    ],
    outputName: 'ESO Body Diagram',
    outputDesc: 'SVG injury map — 26 body zones, severity colors, recovery bars, XP penalty. SHIPPED.',
    xpReward: 350, craftTime: '1 session',
  },
  {
    id: 'cp-crafting',
    name: 'Phase 10: Crafting Station',
    lore: 'ESO crafting metaphor applied to real-world project tracking. Forge blueprints for survival gear, software tools, trading strategies, and RedTeam scripts.',
    category: 'dev', sub: 'char-prog', difficulty: 'master',
    requirements: [
      { icon: '🎨', label: 'ESO station tabs + recipe grid + detail pane' },
      { icon: '💾', label: 'localStorage persistence for craft status' },
      { icon: '🧪', label: '345/345 Karma tests still passing post-wire' },
    ],
    outputName: 'Crafting Station',
    outputDesc: 'Full crafting system — Wilderness + Dev workshop with 28 recipes. Active now.',
    xpReward: 400, craftTime: '1-2 sessions',
  },
  {
    id: 'cp-xp-charts',
    name: 'XP Projection Charts',
    lore: 'Visual ETA for every skill level. Current streak data × consolidation curve → Chart.js rendering. When will you hit Level 30 Developer? Know exactly.',
    category: 'dev', sub: 'char-prog', difficulty: 'expert',
    requirements: [
      { icon: '📊', label: 'Chart.js or ngx-charts integration' },
      { icon: '🧮', label: 'Projection formulas using streak + consolidation bonus' },
      { icon: '⚡', label: 'Angular signal reactivity on data change' },
    ],
    outputName: 'Forecast Engine',
    outputDesc: 'Level ETA for every skill tree. Visual projection curves per discipline.',
    xpReward: 280, craftTime: '2 sessions',
  },
  {
    id: 'cp-pwa',
    name: 'Mobile PWA Setup',
    lore: 'Dashboard installable on Android/iOS. Service worker caches the shell. Manifest provides the launcher icon. Phone becomes a progression terminal.',
    category: 'dev', sub: 'char-prog', difficulty: 'adept',
    requirements: [
      { icon: '📱', label: 'ng add @angular/pwa + service worker config' },
      { icon: '🖼', label: 'App manifest with 192×192 and 512×512 icons' },
      { icon: '🌐', label: 'Offline-first shell caching strategy' },
    ],
    outputName: 'PWA Build',
    outputDesc: 'Installable dashboard on Android/iOS. Offline shell caching. No browser bar.',
    xpReward: 180, craftTime: '1 session',
  },
  {
    id: 'cp-parser-v2',
    name: 'Character Parser v2',
    lore: 'Regex-based parsers break when markdown format evolves. A tokenizer + section boundary detector gives 100% coverage across any future format changes.',
    category: 'dev', sub: 'char-prog', difficulty: 'master',
    requirements: [
      { icon: '🔬', label: 'Design tokenizer for heading-bounded sections' },
      { icon: '🧪', label: 'Jest test suite with format variant fixtures' },
      { icon: '🔄', label: 'Backwards compat with existing character-sheet.md' },
    ],
    outputName: 'Parser v2',
    outputDesc: '100% format coverage — testable, resilient to markdown evolution. Zero regex debt.',
    xpReward: 300, craftTime: '3 sessions',
  },

  // ── DEV WORKSHOP: QUANTCONNECT ─────────────────────────────────────────────────

  {
    id: 'qc-dual-momentum',
    name: 'Dual Momentum Strategy',
    lore: '12-1 month absolute + relative momentum. Long equity when outperforming bonds + positive absolute return. Gary Antonacci\'s evidence-based approach — backtested to 1970.',
    category: 'dev', sub: 'quantconnect', difficulty: 'master',
    requirements: [
      { icon: '🐍', label: 'Python + QuantConnect LEAN environment' },
      { icon: '📈', label: 'Momentum indicator: 12-1 month total return calc' },
      { icon: '🔬', label: 'Backtest 2000-present with SPY, EFA, AGG universe' },
    ],
    outputName: 'Dual Momentum Algorithm',
    outputDesc: 'Absolute + relative momentum rotator. Historically 15%+ CAGR with reduced drawdown.',
    xpReward: 350, craftTime: '1 week',
  },
  {
    id: 'qc-mean-reversion',
    name: 'Mean Reversion (BB + RSI)',
    lore: 'Buy the dip in an uptrend. Bollinger Band squeeze identifies compression. RSI confirmation filters noise. Entry on close below lower band + RSI < 35.',
    category: 'dev', sub: 'quantconnect', difficulty: 'expert',
    requirements: [
      { icon: '📊', label: 'BollingerBands indicator + RSI indicator wired' },
      { icon: '📏', label: 'Entry/exit rules + stop-loss at ATR multiple' },
      { icon: '⚙', label: 'Position sizing: Kelly criterion or fixed fraction' },
    ],
    outputName: 'Mean Reversion Bot',
    outputDesc: 'BB squeeze + RSI entry system. Trend-filtered mean reversion with ATR stops.',
    xpReward: 280, craftTime: '3 sessions',
  },
  {
    id: 'qc-risk-parity',
    name: 'Risk Parity Portfolio',
    lore: 'Equal volatility contribution — not equal dollar weight. Covariance matrix determines allocation. Bonds get more dollars; equities get fewer. Ray Dalio\'s All Weather rationale.',
    category: 'dev', sub: 'quantconnect', difficulty: 'master',
    requirements: [
      { icon: '🧮', label: 'Covariance matrix from rolling 60-day returns' },
      { icon: '⚖', label: 'Target volatility allocation per asset class' },
      { icon: '🔄', label: 'Monthly rebalance logic with drift threshold' },
    ],
    outputName: 'Risk Parity Allocator',
    outputDesc: 'Equal-risk contribution across equity/bond/commodity/gold. All-season portfolio.',
    xpReward: 400, craftTime: '1 week',
  },
  {
    id: 'qc-backtest-harness',
    name: 'Backtest Framework',
    lore: 'Parameter sweeps without walk-forward validation are just curve fitting. Build the harness first: in-sample optimization + out-of-sample holdout + Monte Carlo.',
    category: 'dev', sub: 'quantconnect', difficulty: 'master',
    requirements: [
      { icon: '🔬', label: 'Walk-forward validation engine (rolling window)' },
      { icon: '📊', label: 'Sharpe, Calmar, Max Drawdown metric collection' },
      { icon: '🎲', label: 'Monte Carlo simulation (1000 paths per strategy)' },
    ],
    outputName: 'Backtest Framework',
    outputDesc: 'Walk-forward + Monte Carlo harness. Reproducible strategy evaluation. Anti-overfit.',
    xpReward: 320, craftTime: '4 sessions',
  },
  {
    id: 'qc-options-flow',
    name: 'Options Flow Scanner',
    lore: 'Unusual options activity as a leading directional indicator. Volume/OI ratios + put-call skew + large premium sweep detection — follow the informed money.',
    category: 'dev', sub: 'quantconnect', difficulty: 'expert',
    requirements: [
      { icon: '📡', label: 'CBOE options data feed or alternative API' },
      { icon: '📊', label: 'Volume vs OI ratio + directional signal thresholds' },
      { icon: '🔔', label: 'Alert system for unusual sweep detection' },
    ],
    outputName: 'Options Flow Alert',
    outputDesc: 'Smart money tracker via unusual options activity. Directional signal generator.',
    xpReward: 280, craftTime: '3 sessions',
  },

  // ── DEV WORKSHOP: REDTEAM ─────────────────────────────────────────────────────

  {
    id: 'rt-xss-library',
    name: 'XSS Payload Library v2',
    lore: 'Context determines the payload. HTML body ≠ JS context ≠ attribute injection ≠ URL param. Build 50+ payloads organized by injection context — not a generic list.',
    category: 'dev', sub: 'redteam', difficulty: 'adept',
    requirements: [
      { icon: '📚', label: 'Research 5 injection contexts: HTML/JS/attr/URL/DOM' },
      { icon: '🔧', label: 'WAF bypass variants: encoding, event handler, tag swap' },
      { icon: '📁', label: 'Organize in YAML by context + WAF bypass technique' },
    ],
    outputName: 'XSS Arsenal',
    outputDesc: '50+ context-aware payloads organized by injection point. WAF bypass variants included.',
    xpReward: 200, craftTime: '2 sessions',
  },
  {
    id: 'rt-wordlist',
    name: 'Custom Recon Wordlist',
    lore: 'Default wordlists find default paths. Targets have custom tech stacks, internal naming conventions, and company-specific endpoints seclists have never seen.',
    category: 'dev', sub: 'redteam', difficulty: 'adept',
    requirements: [
      { icon: '🔍', label: 'Analyze target tech stack (Angular, Spring Boot patterns)' },
      { icon: '🧩', label: 'Combine SecLists Raft-Medium + custom business terms' },
      { icon: '📏', label: 'Deduplicate + sort by likely hit probability' },
    ],
    outputName: 'Target Wordlist',
    outputDesc: '10K+ org-specific entries. Tech-stack aware. Merged from SecLists + custom research.',
    xpReward: 150, craftTime: '1 session',
  },
  {
    id: 'rt-idor-script',
    name: 'IDOR Automation Script',
    lore: 'Manual IDOR testing one ID at a time cannot find what automated enumeration finds in minutes. Response diff comparison reveals access control gaps at scale.',
    category: 'dev', sub: 'redteam', difficulty: 'expert',
    requirements: [
      { icon: '🐍', label: 'Python + requests library + rate limit throttling' },
      { icon: '🔢', label: 'ID range enumeration (sequential, UUID, hash patterns)' },
      { icon: '🔎', label: 'Response diff: status code + content-length + body keywords' },
    ],
    outputName: 'IDOR Scanner',
    outputDesc: 'Automated BOLA/IDOR tester. Response-diff based detection. Scope-validated.',
    xpReward: 280, craftTime: '2 sessions',
  },
  {
    id: 'rt-cookie-audit',
    name: 'Cookie Security Auditor',
    lore: 'SameSite=None without Secure. HttpOnly absent on session tokens. These misconfigs appear in 40% of targets. Build the scanner that catches them all.',
    category: 'dev', sub: 'redteam', difficulty: 'adept',
    requirements: [
      { icon: '🐍', label: 'Python + requests — capture Set-Cookie headers' },
      { icon: '🔍', label: 'Check: Secure, HttpOnly, SameSite, Domain, Path flags' },
      { icon: '📋', label: 'OWASP compliance report generation (pass/fail per flag)' },
    ],
    outputName: 'Cookie Auditor',
    outputDesc: 'OWASP cookie flag compliance scanner. Generates pass/fail report per endpoint.',
    xpReward: 180, craftTime: '1-2 sessions',
  },
  {
    id: 'rt-jwt-suite',
    name: 'JWT Attack Suite',
    lore: 'alg:none. HS256→RS256 key confusion. Weak HMAC secret bruteforce. Header injection. JWT vulnerabilities are predictable — and predictably impactful.',
    category: 'dev', sub: 'redteam', difficulty: 'master',
    requirements: [
      { icon: '🔑', label: 'PyJWT + manual header manipulation (alg:none test)' },
      { icon: '🔀', label: 'Key confusion: HS256 with RS256 public key as secret' },
      { icon: '💪', label: 'HMAC secret brute: hashcat + jwt-cracker + rockyou' },
    ],
    outputName: 'JWT Attacker',
    outputDesc: 'Signature bypass + secret cracker + confusion attack suite. OWASP A07 coverage.',
    xpReward: 350, craftTime: '3 sessions',
  },
];

// ── Station Config ─────────────────────────────────────────────────────────────

const STATIONS: { id: StationId; icon: string; label: string; lore: string }[] = [
  {
    id: 'wilderness',
    icon: '🌲',
    label: 'Wilderness Forge',
    lore: 'Craft survival equipment, field skills, and bushcraft competencies. Primitive fire, field medicine, orienteering — forged in practice, not theory.',
  },
  {
    id: 'dev',
    icon: '⚙',
    label: 'Dev Workshop',
    lore: 'Build software tools, systems, and strategies. Enterprise features, progression UI, trading algorithms, and RedTeam scripts — all tracked as craftable blueprints.',
  },
];

const DEV_SUBS: { id: DevSubId; icon: string; label: string }[] = [
  { id: 'enterprise',   icon: '📦', label: 'Enterprise' },
  { id: 'char-prog',    icon: '⚔', label: 'Char-Prog' },
  { id: 'quantconnect', icon: '📈', label: 'QuantConnect' },
  { id: 'redteam',      icon: '◉', label: 'RedTeam' },
];

const STORAGE_KEY = 'cs_craft_entries_v1';

// ── Component ──────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-crafting-station',
  standalone: true,
  imports: [CommonModule, FormsModule, TitleCasePipe],
  template: `
    <section class="eso-panel cs-panel">

      <!-- ── Header ─────────────────────────────────────────────── -->
      <div class="cs-header">
        <h3 class="eso-panel-title">Crafting Workshop</h3>
        <div class="cs-station-tabs">
          <button *ngFor="let s of stations" class="cs-station-tab"
            [class.cs-station-active]="activeStation() === s.id"
            (click)="setStation(s.id)">
            <span class="cs-station-icon">{{ s.icon }}</span>
            <span class="cs-station-label">{{ s.label }}</span>
          </button>
        </div>
      </div>

      <!-- ── Dev Sub-tabs ────────────────────────────────────────── -->
      <div class="cs-dev-subs" *ngIf="activeStation() === 'dev'">
        <button *ngFor="let sub of devSubs" class="cs-sub-tab"
          [class.cs-sub-active]="activeDevSub() === sub.id"
          (click)="setDevSub(sub.id)">
          <span>{{ sub.icon }}</span> {{ sub.label }}
          <span class="cs-sub-count">{{ getSubCount(sub.id) }}</span>
        </button>
      </div>

      <!-- ── Station lore ────────────────────────────────────────── -->
      <p class="cs-station-lore">{{ activeStationLore() }}</p>

      <!-- ── Two-pane body ──────────────────────────────────────── -->
      <div class="cs-body">

        <!-- LEFT: Recipe grid -->
        <div class="cs-recipe-panel">

          <div class="cs-recipe-toolbar">
            <input class="cs-search" [ngModel]="searchQuery()" (ngModelChange)="searchQuery.set($event)" placeholder="Search recipes..." />
            <div class="cs-counts">
              <span class="cs-count-chip cs-count-total">{{ filteredRecipes().length }} recipes</span>
              <span class="cs-count-chip cs-count-done"  *ngIf="completedInView() > 0">{{ completedInView() }} complete</span>
            </div>
          </div>

          <div class="cs-recipe-grid">
            <div *ngFor="let recipe of filteredRecipes(); trackBy: trackByRecipe"
                 class="cs-recipe-card"
                 [class.cs-card-selected]="selectedRecipe()?.id === recipe.id"
                 [class.cs-card-progress]="getStatus(recipe.id) === 'in-progress'"
                 [class.cs-card-done]="getStatus(recipe.id) === 'completed'"
                 [class.cs-card-locked]="isRecipeLocked(recipe)"
                 (click)="selectRecipe(recipe)">

              <div class="cs-card-top">
                <span class="cs-diff-badge cs-diff-{{ recipe.difficulty }}">{{ recipe.difficulty }}</span>
                <span class="cs-status-icon">{{ isRecipeLocked(recipe) ? '🔒' : getStatusIcon(recipe.id) }}</span>
              </div>

              <div class="cs-card-name">{{ recipe.name }}</div>

              <div class="cs-card-meta">
                <span class="cs-card-xp">⚡ {{ recipe.xpReward }} XP</span>
                <span class="cs-card-time">⏱ {{ recipe.craftTime }}</span>
              </div>
            </div>

            <div class="cs-empty" *ngIf="filteredRecipes().length === 0">
              <span>No recipes match your search</span>
            </div>
          </div>
        </div>

        <!-- RIGHT: Detail pane -->
        <div class="cs-detail-pane" *ngIf="selectedRecipe(); else noSelection">
          <div class="cs-detail-inner">

            <!-- Title + difficulty -->
            <div class="cs-detail-header">
              <h4 class="cs-detail-name">{{ selectedRecipe()!.name }}</h4>
              <span class="cs-diff-badge cs-diff-{{ selectedRecipe()!.difficulty }}">
                {{ selectedRecipe()!.difficulty }}
              </span>
            </div>

            <!-- Lore -->
            <p class="cs-detail-lore">{{ selectedRecipe()!.lore }}</p>

            <!-- Requirements -->
            <div class="cs-requirements">
              <div class="cs-req-title">REQUIREMENTS</div>
              <div *ngFor="let req of selectedRecipe()!.requirements" class="cs-req-row">
                <span class="cs-req-icon">{{ req.icon }}</span>
                <span class="cs-req-label">{{ req.label }}</span>
              </div>
            </div>

            <!-- Output -->
            <div class="cs-output">
              <div class="cs-output-title">OUTPUT</div>
              <div class="cs-output-name">{{ selectedRecipe()!.outputName }}</div>
              <div class="cs-output-desc">{{ selectedRecipe()!.outputDesc }}</div>
            </div>

            <!-- XP + time -->
            <div class="cs-detail-metrics">
              <div class="cs-metric">
                <span class="cs-metric-label">XP Reward</span>
                <span class="cs-metric-val cs-xp-val">⚡ {{ selectedRecipe()!.xpReward }}</span>
              </div>
              <div class="cs-metric">
                <span class="cs-metric-label">Craft Time</span>
                <span class="cs-metric-val">⏱ {{ selectedRecipe()!.craftTime }}</span>
              </div>
            </div>

            <!-- Lock notice (overrides all action buttons when recipe is locked) -->
            <div class="cs-actions cs-actions-locked" *ngIf="isRecipeLocked(selectedRecipe()!)">
              <div class="cs-locked-badge">
                🔒 LOCKED — Requires {{ selectedRecipe()!.requiredClassLevel!.class | titlecase }} Level {{ selectedRecipe()!.requiredClassLevel!.level }}
              </div>
              <p class="cs-locked-hint">Keep earning XP in this class to unlock this recipe.</p>
            </div>

            <!-- Action buttons (only shown when recipe is unlocked) -->
            <ng-container *ngIf="!isRecipeLocked(selectedRecipe()!)">
              <div class="cs-actions" *ngIf="getStatus(selectedRecipe()!.id) === 'available'">
                <button class="cs-btn cs-btn-forge" (click)="startCraft(selectedRecipe()!)">
                  ⚒ FORGE IT
                </button>
              </div>
              <div class="cs-actions cs-actions-progress" *ngIf="getStatus(selectedRecipe()!.id) === 'in-progress'">
                <div class="cs-in-progress-badge">⚒ IN PROGRESS — {{ getStartedLabel(selectedRecipe()!.id) }}</div>
                <button class="cs-btn cs-btn-complete" (click)="completeCraft(selectedRecipe()!)">
                  ✓ MARK COMPLETE
                </button>
                <button class="cs-btn cs-btn-abandon" (click)="abandonCraft(selectedRecipe()!)">
                  ✕ Abandon
                </button>
              </div>
              <div class="cs-actions cs-actions-done" *ngIf="getStatus(selectedRecipe()!.id) === 'completed'">
                <div class="cs-completed-badge">✓ CRAFTED — {{ getCompletedLabel(selectedRecipe()!.id) }}</div>
                <button class="cs-btn cs-btn-abandon" (click)="abandonCraft(selectedRecipe()!)">
                  ↩ Reset
                </button>
              </div>
            </ng-container>

          </div>
        </div>

        <!-- No selection placeholder -->
        <ng-template #noSelection>
          <div class="cs-detail-pane cs-detail-empty">
            <span class="cs-detail-empty-icon">⚒</span>
            <span>Select a recipe to view blueprint</span>
          </div>
        </ng-template>

      </div>

      <!-- ── Completed Items Strip ───────────────────────────────── -->
      <div class="cs-completed-strip" *ngIf="allCompleted().length > 0">
        <div class="cs-strip-title">CRAFTED ITEMS ({{ allCompleted().length }})</div>
        <div class="cs-strip-scroll">
          <div *ngFor="let entry of allCompleted()" class="cs-strip-item">
            <span class="cs-strip-icon">✓</span>
            <span class="cs-strip-name">{{ getRecipeName(entry.recipeId) }}</span>
            <span class="cs-strip-xp">⚡{{ getRecipeXp(entry.recipeId) }}</span>
          </div>
        </div>
      </div>

    </section>
  `,
  styles: [`
    /* ── ESO Crafting Station ────────────────────────────────────── */
    :host { display: block; }
    .cs-panel {
      background: var(--eso-bg-panel, #100e07);
      border: 1px solid var(--eso-border, rgba(155,115,38,0.45));
      padding: 16px 18px;
      font-family: 'Cinzel', serif;
    }

    /* ── Header ─────────────────────────────────────────────────── */
    .cs-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      flex-wrap: wrap; gap: 10px; margin-bottom: 12px;
    }
    .cs-station-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
    .cs-station-tab {
      display: flex; align-items: center; gap: 6px;
      background: transparent;
      border: 1px solid rgba(155,115,38,0.30);
      color: var(--eso-text-dim, #a08858);
      font-size: 11px; letter-spacing: 0.5px;
      padding: 6px 14px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: all 0.14s;
    }
    .cs-station-tab:hover { border-color: rgba(201,168,76,0.5); color: var(--eso-text, #e2cfa8); }
    .cs-station-active {
      border-color: var(--eso-gold, #c9a84c);
      color: var(--eso-gold, #c9a84c);
      background: rgba(201,168,76,0.08);
    }
    .cs-station-icon  { font-size: 16px; }
    .cs-station-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }

    /* ── Dev Sub-tabs ────────────────────────────────────────────── */
    .cs-dev-subs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; }
    .cs-sub-tab {
      display: flex; align-items: center; gap: 5px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(155,115,38,0.22);
      color: var(--eso-text-dim, #a08858);
      font-size: 10px; letter-spacing: 0.5px;
      padding: 4px 10px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: all 0.14s;
    }
    .cs-sub-tab:hover   { border-color: rgba(201,168,76,0.4); color: var(--eso-text, #e2cfa8); }
    .cs-sub-active      { border-color: var(--eso-gold, #c9a84c); color: var(--eso-text, #e2cfa8); background: rgba(201,168,76,0.06); }
    .cs-sub-count {
      background: rgba(201,168,76,0.15); color: var(--eso-gold, #c9a84c);
      font-size: 9px; padding: 1px 5px; margin-left: 2px;
      border: 1px solid rgba(201,168,76,0.25);
    }

    /* ── Station Lore ────────────────────────────────────────────── */
    .cs-station-lore {
      font-size: 11px; color: rgba(160,136,88,0.6); font-family: sans-serif;
      font-style: italic; line-height: 1.5; margin: 0 0 14px 0;
      padding: 8px 12px; border-left: 2px solid rgba(155,115,38,0.25);
    }

    /* ── Two-pane body ───────────────────────────────────────────── */
    .cs-body { display: flex; gap: 16px; align-items: flex-start; }

    /* ── LEFT: Recipe panel ──────────────────────────────────────── */
    .cs-recipe-panel { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }

    .cs-recipe-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .cs-search {
      flex: 1; min-width: 140px;
      background: rgba(0,0,0,0.4); border: 1px solid rgba(201,168,76,0.28);
      color: var(--eso-text, #e2cfa8); font-size: 11px; font-family: 'Cinzel', serif;
      padding: 6px 10px; outline: none;
    }
    .cs-search:focus    { border-color: rgba(201,168,76,0.6); }
    .cs-search::placeholder { color: rgba(160,136,88,0.5); }
    .cs-counts          { display: flex; gap: 6px; }
    .cs-count-chip      { font-size: 9px; padding: 2px 7px; letter-spacing: 0.5px; text-transform: uppercase; }
    .cs-count-total     { border: 1px solid rgba(155,115,38,0.3); color: var(--eso-text-dim, #a08858); }
    .cs-count-done      { border: 1px solid rgba(111,207,125,0.4); color: #6fcf7d; background: rgba(111,207,125,0.06); }

    .cs-recipe-grid  { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .cs-recipe-card  {
      background: var(--eso-bg-panel-alt, #1a1408);
      border: 1px solid rgba(155,115,38,0.28);
      padding: 10px 12px; cursor: pointer; transition: all 0.14s;
    }
    .cs-recipe-card:hover   { border-color: rgba(201,168,76,0.45); background: rgba(201,168,76,0.04); }
    .cs-card-selected       { border-color: var(--eso-gold, #c9a84c) !important; background: rgba(201,168,76,0.08) !important; }
    .cs-card-progress       { border-color: rgba(242,140,40,0.6) !important; animation: cs-forge-pulse 2.2s ease-in-out infinite; }
    .cs-card-done           { opacity: 0.55; border-color: rgba(111,207,125,0.35) !important; }
    .cs-card-locked         { opacity: 0.4; cursor: not-allowed; border-color: rgba(150,150,180,0.3) !important; }
    .cs-card-locked:hover   { transform: none !important; }

    .cs-actions-locked      { padding: 12px 0; }
    .cs-locked-badge        { font-size: 13px; font-weight: 700; color: #9090b8; letter-spacing: 0.05em; margin-bottom: 6px; }
    .cs-locked-hint         { font-size: 11px; color: rgba(224,213,192,0.45); margin: 0; }

    @keyframes cs-forge-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(242,140,40,0); }
      50%       { box-shadow: 0 0 8px 2px rgba(242,140,40,0.18); }
    }

    .cs-card-top    { display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px; }
    .cs-card-name   { font-size: 11px; font-weight: 700; color: var(--eso-text, #e2cfa8); line-height: 1.3; margin-bottom: 5px; }
    .cs-card-meta   { display: flex; gap: 8px; }
    .cs-card-xp     { font-size: 9px; color: var(--eso-gold, #c9a84c); letter-spacing: 0.5px; }
    .cs-card-time   { font-size: 9px; color: var(--eso-text-dim, #a08858); }
    .cs-status-icon { font-size: 14px; }

    /* Difficulty badges */
    .cs-diff-badge  { font-size: 8px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; padding: 2px 6px; border: 1px solid currentColor; }
    .cs-diff-novice    { color: #6fcf7d; }
    .cs-diff-adept     { color: #e6a833; }
    .cs-diff-expert    { color: #f28c28; }
    .cs-diff-master    { color: #e05c44; }

    .cs-empty { grid-column: 1 / -1; text-align: center; padding: 24px; color: var(--eso-text-dim, #a08858); font-size: 12px; }

    /* ── RIGHT: Detail pane ──────────────────────────────────────── */
    .cs-detail-pane {
      width: 300px; flex-shrink: 0;
      background: var(--eso-bg-panel-alt, #1a1408);
      border: 1px solid rgba(155,115,38,0.28);
      padding: 14px 16px;
      max-height: 560px; overflow-y: auto;
    }
    .cs-detail-empty {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      justify-content: center; color: var(--eso-text-dim, #a08858);
      font-size: 11px; min-height: 200px;
    }
    .cs-detail-empty-icon { font-size: 32px; opacity: 0.35; }

    .cs-detail-header {
      display: flex; align-items: flex-start; gap: 8px; margin-bottom: 10px;
      justify-content: space-between;
    }
    .cs-detail-name { font-size: 12px; font-weight: 700; color: var(--eso-text, #e2cfa8); margin: 0; flex: 1; min-width: 0; }
    .cs-detail-lore {
      font-size: 11px; color: rgba(160,136,88,0.75); font-family: sans-serif;
      font-style: italic; line-height: 1.5; margin: 0 0 12px 0;
    }

    .cs-requirements { margin-bottom: 12px; }
    .cs-req-title    { font-size: 8px; letter-spacing: 2px; color: var(--eso-text-dim, #a08858); text-transform: uppercase; margin-bottom: 6px; }
    .cs-req-row      { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 4px; }
    .cs-req-icon     { flex-shrink: 0; font-size: 14px; }
    .cs-req-label    { font-size: 11px; color: var(--eso-text, #e2cfa8); font-family: sans-serif; line-height: 1.4; }

    .cs-output {
      background: rgba(201,168,76,0.06);
      border: 1px solid rgba(201,168,76,0.25);
      padding: 8px 10px; margin-bottom: 12px;
    }
    .cs-output-title { font-size: 8px; letter-spacing: 2px; color: var(--eso-gold, #c9a84c); text-transform: uppercase; margin-bottom: 4px; }
    .cs-output-name  { font-size: 12px; font-weight: 700; color: var(--eso-text, #e2cfa8); margin-bottom: 3px; }
    .cs-output-desc  { font-size: 10px; color: var(--eso-text-dim, #a08858); font-family: sans-serif; line-height: 1.4; }

    .cs-detail-metrics { display: flex; gap: 12px; margin-bottom: 14px; }
    .cs-metric       { flex: 1; background: rgba(0,0,0,0.3); padding: 6px 8px; }
    .cs-metric-label { display: block; font-size: 8px; letter-spacing: 1px; color: var(--eso-text-dim, #a08858); text-transform: uppercase; margin-bottom: 3px; }
    .cs-metric-val   { font-size: 12px; color: var(--eso-text, #e2cfa8); }
    .cs-xp-val       { color: var(--eso-gold, #c9a84c); font-weight: 700; }

    .cs-actions { display: flex; flex-direction: column; gap: 6px; }
    .cs-btn {
      background: transparent; border: 1px solid;
      font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
      padding: 9px 14px; cursor: pointer; font-family: 'Cinzel', serif;
      transition: all 0.14s; font-weight: 700;
    }
    .cs-btn-forge   { border-color: var(--eso-gold, #c9a84c); color: var(--eso-gold, #c9a84c); }
    .cs-btn-forge:hover { background: rgba(201,168,76,0.12); }
    .cs-btn-complete { border-color: #6fcf7d; color: #6fcf7d; }
    .cs-btn-complete:hover { background: rgba(111,207,125,0.10); }
    .cs-btn-abandon  { border-color: rgba(155,115,38,0.28); color: rgba(160,136,88,0.65); font-size: 10px; }
    .cs-btn-abandon:hover { border-color: #e05c44; color: #e05c44; }

    .cs-in-progress-badge {
      font-size: 10px; color: #f28c28; letter-spacing: 0.5px; font-family: sans-serif;
      padding: 5px 8px; border-left: 2px solid #f28c28;
      background: rgba(242,140,40,0.07); margin-bottom: 2px;
    }
    .cs-completed-badge {
      font-size: 10px; color: #6fcf7d; letter-spacing: 0.5px; font-family: sans-serif;
      padding: 5px 8px; border-left: 2px solid #6fcf7d;
      background: rgba(111,207,125,0.07); margin-bottom: 2px;
    }

    /* ── Completed Strip ─────────────────────────────────────────── */
    .cs-completed-strip {
      margin-top: 18px;
      border-top: 1px solid rgba(155,115,38,0.20);
      padding-top: 12px;
    }
    .cs-strip-title  { font-size: 8px; letter-spacing: 2px; color: var(--eso-text-dim, #a08858); text-transform: uppercase; margin-bottom: 8px; }
    .cs-strip-scroll { display: flex; flex-wrap: wrap; gap: 6px; }
    .cs-strip-item   {
      display: flex; align-items: center; gap: 5px;
      background: rgba(111,207,125,0.07);
      border: 1px solid rgba(111,207,125,0.30);
      padding: 4px 10px; font-size: 10px;
    }
    .cs-strip-icon   { color: #6fcf7d; font-size: 11px; }
    .cs-strip-name   { color: var(--eso-text, #e2cfa8); }
    .cs-strip-xp     { color: var(--eso-gold, #c9a84c); font-size: 9px; }

    /* ── Mobile ──────────────────────────────────────────────────── */
    @media (max-width: 700px) {
      .cs-body         { flex-direction: column; }
      .cs-detail-pane  { width: 100%; max-height: unset; }
      .cs-recipe-grid  { grid-template-columns: 1fr; }
      .cs-station-tabs { gap: 4px; }
      .cs-station-tab  { padding: 5px 10px; font-size: 10px; }
    }
  `]
})
export class CraftingStationComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly stations = STATIONS;
  readonly devSubs  = DEV_SUBS;

  activeStation  = signal<StationId>('wilderness');
  activeDevSub   = signal<DevSubId>('enterprise');
  selectedRecipe = signal<Recipe | null>(null);
  searchQuery    = signal<string>('');

  /** Player's current class levels keyed by lowercase class name (e.g. 'warrior', 'developer') */
  classLevels = signal<Record<string, number>>({});

  private entries: CraftEntry[] = [];

  ngOnInit(): void {
    this.loadEntries();
    this.loadClassLevels();
    // Pre-mark Phase 8 as completed since it was shipped this session
    this.ensureEntry('cp-body-status', 'completed');
  }

  // ── Derived ───────────────────────────────────────────────────────────────────

  filteredRecipes = computed<Recipe[]>(() => {
    const station = this.activeStation();
    const sub     = this.activeDevSub();
    const q       = this.searchQuery().toLowerCase();

    return RECIPES.filter(r => {
      if (r.category !== station) return false;
      if (station === 'dev' && r.sub !== sub) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.lore.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  completedInView = computed(() =>
    this.filteredRecipes().filter(r => this.getStatus(r.id) === 'completed').length
  );

  allCompleted = computed(() =>
    this.entries.filter(e => e.status === 'completed')
  );

  activeStationLore = computed(() =>
    STATIONS.find(s => s.id === this.activeStation())?.lore ?? ''
  );

  // ── Station / Sub navigation ──────────────────────────────────────────────────

  setStation(id: StationId): void {
    this.activeStation.set(id);
    this.selectedRecipe.set(null);
  }

  setDevSub(id: DevSubId): void {
    this.activeDevSub.set(id);
    this.selectedRecipe.set(null);
  }

  getSubCount(sub: DevSubId): number {
    return RECIPES.filter(r => r.category === 'dev' && r.sub === sub).length;
  }

  // ── Recipe interaction ────────────────────────────────────────────────────────

  selectRecipe(recipe: Recipe): void {
    this.selectedRecipe.set(recipe);
  }

  trackByRecipe(_i: number, r: Recipe): string {
    return r.id;
  }

  // ── Craft status ──────────────────────────────────────────────────────────────

  getStatus(recipeId: string): CraftStatus {
    return this.entries.find(e => e.recipeId === recipeId)?.status ?? 'available';
  }

  getStatusIcon(recipeId: string): string {
    const s = this.getStatus(recipeId);
    if (s === 'completed')  return '✓';
    if (s === 'in-progress') return '⚒';
    return '';
  }

  getStartedLabel(recipeId: string): string {
    const e = this.entries.find(e => e.recipeId === recipeId);
    if (!e?.startedAt) return '';
    return new Date(e.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  getCompletedLabel(recipeId: string): string {
    const e = this.entries.find(e => e.recipeId === recipeId);
    if (!e?.completedAt) return '';
    return new Date(e.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  startCraft(recipe: Recipe): void {
    this.upsertEntry({ recipeId: recipe.id, status: 'in-progress', startedAt: new Date().toISOString() });
  }

  completeCraft(recipe: Recipe): void {
    if (this.isRecipeLocked(recipe)) {
      console.warn(`[Crafting] Recipe '${recipe.name}' is locked — class level requirement not met`);
      return;
    }
    const existing = this.entries.find(e => e.recipeId === recipe.id);
    this.upsertEntry({
      recipeId: recipe.id,
      status: 'completed',
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    // Award real XP via backend
    this.http.post(`${environment.apiUrl}/api/activities`, {
      activityType: this.recipeToActivityType(recipe),
      xp: recipe.xpReward,
      notes: `Crafted: ${recipe.outputName}`,
      clientDate: new Date().toISOString().slice(0, 10),
    }).pipe(catchError(() => of(null))).subscribe();
  }

  abandonCraft(recipe: Recipe): void {
    this.entries = this.entries.filter(e => e.recipeId !== recipe.id);
    this.saveEntries();
  }

  private recipeToActivityType(recipe: Recipe): string {
    if (recipe.category === 'wilderness') return 'wilderness-craft';
    const subMap: Record<string, string> = {
      'enterprise':   'dev-story',
      'char-prog':    'paladin-app-dev',
      'quantconnect': 'financial-project',
      'redteam':      'redteam-lab',
    };
    return subMap[recipe.sub ?? ''] ?? 'personal-project';
  }

  // ── Strip helpers ─────────────────────────────────────────────────────────────

  getRecipeName(recipeId: string): string {
    return RECIPES.find(r => r.id === recipeId)?.name ?? recipeId;
  }

  getRecipeXp(recipeId: string): number {
    return RECIPES.find(r => r.id === recipeId)?.xpReward ?? 0;
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  /** Fetches the player's current class levels from the API and populates classLevels signal */
  private loadClassLevels(): void {
    this.http.get<any>(`${environment.apiUrl}/api/character/stats`).pipe(
      catchError(() => of(null))
    ).subscribe(res => {
      if (res?.skillTrees) {
        const levels: Record<string, number> = {};
        (res.skillTrees as Array<{ name: string; level: number }>).forEach(s => {
          levels[s.name.toLowerCase()] = s.level ?? 1;
        });
        this.classLevels.set(levels);
      }
    });
  }

  /**
   * Returns true if the recipe has a class level requirement that the player hasn't met yet.
   * Recipes without requiredClassLevel are always unlocked.
   */
  isRecipeLocked(recipe: Recipe): boolean {
    if (!recipe.requiredClassLevel) return false;
    const { class: cls, level: reqLevel } = recipe.requiredClassLevel;
    const playerLevel = this.classLevels()[cls.toLowerCase()] ?? 0;
    return playerLevel < reqLevel;
  }

  private loadEntries(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this.entries = raw ? JSON.parse(raw) : [];
    } catch {
      this.entries = [];
    }
  }

  private saveEntries(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
  }

  private upsertEntry(entry: CraftEntry): void {
    const idx = this.entries.findIndex(e => e.recipeId === entry.recipeId);
    if (idx >= 0) this.entries[idx] = entry;
    else this.entries.push(entry);
    this.saveEntries();
    // Trigger computed signals by reassigning reference
    this.entries = [...this.entries];
  }

  private ensureEntry(recipeId: string, status: CraftStatus): void {
    if (!this.entries.find(e => e.recipeId === recipeId)) {
      this.upsertEntry({ recipeId, status, startedAt: new Date().toISOString(), completedAt: new Date().toISOString() });
    }
  }
}
