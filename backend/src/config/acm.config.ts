/**
 * ACM (Action Consequence Matrix) configuration
 *
 * SINGLE SOURCE OF TRUTH for action item count and labels.
 * When adding a new ACM item:
 *   1. Add its label here in ACTION_ITEMS_LABELS
 *   2. Insert its stat weights in acm.routes.ts (W_SPIRITUAL, W_PHYSICAL, W_CLARITY, W_PLEASURE)
 *   3. Update frontend ITEM_LABELS in acm-panel.component.ts
 *   4. Update HYDRATION_IDX / PROTEIN_IDX in acm-panel.component.ts if indices shifted
 *   5. Update ACM_ITEM_WEIGHTS in vault.ts (canonical) AND vault-panel.component.ts (copy)
 *   6. Update journalWriter.service.ts template
 *   7. Update copilot-instructions.md + gamification-specialist.agent.md Action Consequence Log section
 *
 *   NOTE: acm.routes.spec.ts and actionLog.routes.spec.ts use ACM_ITEM_COUNT from here — no hardcode changes needed in tests.
 *
 * Stat index map (0-based):
 *  0: Abstained alcohol        7: Fasting
 *  1: Wake Up With God         8: Hydration Discipline
 *  2: Physical Training        9: Diet Plan (Dr. Alfred)
 *  3: Deep Work: Dev          10: Abstained sexual indulgence
 *  4: Deep Work: RedTeam      11: Protein goal
 *  5: Deep Work: Artist       12: Pre-Sleep Bonfire Routine
 *  6: Deep Work: Mech Eng     13: DR-ALFRED Supplement Stack
 */

export const ACTION_ITEMS_LABELS: string[] = [
  'Abstained from undisciplined alcohol indulgence',        // 0
  'Paladin Training (Wake Up With God)',                    // 1
  'Paladin Training (Physical Training)',                   // 2
  'Deep Work Progress — Web App Developer',                // 3
  'Deep Work Progress — RedTeam',                          // 4
  'Deep Work Progress — Artist',                           // 5
  'Deep Work Progress — Mechanical Engineer',              // 6
  'Fasting ([X] hrs)',                                      // 7
  'Hydration Discipline ([X] oz)',                          // 8
  'Dr. Alfred Diet Plan (no junk food, red meat max 1x/week)', // 9
  'Abstained from undisciplined sexual indulgence',         // 10
  'Consumed trackable protein (0.64g/lb+ of total bodyweight per day)', // 11
  'Pre-Sleep Bonfire Routine',                              // 12
  'DR-ALFRED Supplement Stack (cognitive + physical + sleep stacks)', // 13
];

/** Derived count — never hardcode this number directly */
export const ACM_ITEM_COUNT: number = ACTION_ITEMS_LABELS.length;
