import { questRecordFromRow, questRowFromRecord } from './systemQuest.store';
import { SystemQuestRecord } from '../domain/systemQuest';

function quest(overrides: Partial<SystemQuestRecord> = {}): SystemQuestRecord {
  return {
    id: 'q1',
    userId: 'paul',
    idempotencyKey: 'daily-1',
    kind: 'daily',
    title: 'Walk',
    description: '',
    objectives: [{ id: 'walk', label: 'Walk', target: 1, progress: 0, done: false }],
    deadline: null,
    scheduledFor: null,
    xpReward: { Warrior: 10 },
    rewardNote: null,
    rewardCostsMoney: false,
    rewardApproval: 'not_required',
    penalty: null,
    status: 'active',
    hiddenUntilRevealed: false,
    revealedAt: null,
    source: 'user',
    training: false,
    thursdayTrainingFlag: false,
    recoveryType: null,
    parentQuestId: null,
    targetCostCents: null,
    amountSavedCents: 0,
    inventoryItemId: null,
    resolution: null,
    edits: [],
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

describe('system quest row mapping', () => {
  it('omits acquisition columns on a daily quest so older databases still accept the write', () => {
    const row = questRowFromRecord(quest());
    expect(row.kind).toBe('daily');
    expect(row).not.toHaveProperty('target_cost_cents');
    expect(row).not.toHaveProperty('amount_saved_cents');
    expect(row).not.toHaveProperty('inventory_item_id');
    expect(row).not.toHaveProperty('edits');
  });

  it('writes the acquisition budget and reads it back without turning cents into XP', () => {
    const row = questRowFromRecord(quest({
      kind: 'acquisition',
      xpReward: {},
      targetCostCents: 180000,
      amountSavedCents: 45000,
      inventoryItemId: '11111111-1111-4111-8111-111111111111',
      objectives: [{
        id: 'purchase-gpu',
        label: 'Purchase the RTX 3090',
        target: 1,
        progress: 1,
        done: true,
        xpReward: { Developer: 40 },
        xpAwardedAt: '2026-10-27T01:00:00.000Z',
      }],
    }));
    expect(row.target_cost_cents).toBe(180000);
    expect(row.amount_saved_cents).toBe(45000);
    expect(row.xp_reward).toEqual({});
    expect(row.objectives).toEqual([
      expect.objectContaining({ xpReward: { Developer: 40 } }),
    ]);

    const record = questRecordFromRow({
      ...row,
      user_id: 'paul',
      idempotency_key: 'acquisition:rtx-3090-rig',
    });
    expect(record.targetCostCents).toBe(180000);
    expect(record.amountSavedCents).toBe(45000);
    expect(record.xpReward).toEqual({});
    expect(record.objectives[0].xpReward).toEqual({ Developer: 40 });
  });

  it('treats a pre-014 row as having no budget', () => {
    const record = questRecordFromRow({
      id: 'q1',
      user_id: 'paul',
      idempotency_key: 'daily-1',
      kind: 'daily',
      title: 'Walk',
      description: '',
      objectives: [],
      deadline: null,
      scheduled_for: null,
      xp_reward: { Warrior: 10 },
      reward_note: null,
      reward_costs_money: false,
      reward_approval: 'not_required',
      penalty: null,
      status: 'active',
      hidden_until_revealed: false,
      revealed_at: null,
      source: 'user',
      training: false,
      thursday_training_flag: false,
      recovery_type: null,
      parent_quest_id: null,
      resolution: null,
      created_at: '2026-10-27T00:00:00.000Z',
      updated_at: '2026-10-27T00:00:00.000Z',
      resolved_at: null,
    });
    expect(record.targetCostCents).toBeNull();
    expect(record.amountSavedCents).toBe(0);
    expect(record.inventoryItemId).toBeNull();
  });
});
