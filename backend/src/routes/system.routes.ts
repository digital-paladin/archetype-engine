import { Router, Request, Response } from 'express';
import { SystemQuestError } from '../domain/systemQuest';
import {
  createServiceCredential,
  listServiceCredentials,
  revokeServiceCredential,
} from '../services/serviceCredential.service';
import {
  correctSystemQuest,
  createSystemQuest,
  decideRewardApproval,
  getSystemQuest,
  listSystemMessages,
  listSystemQuests,
  postSystemMessage,
  revealSystemQuest,
  resolveSystemQuest,
  updateAcquisitionBudget,
  updateQuestProgress,
} from '../services/systemQuest.service';
import { ConsumptionError, correctConsumption, listConsumption, logConsumption } from '../services/consumption.service';

const router = Router();

function authOf(req: Request): { userId: string; authKind: 'user' | 'service' } {
  const userId = (req as Request & { userId?: string }).userId;
  const authKind = ((req as Request & { authKind?: string }).authKind ?? 'user') as 'user' | 'service';
  if (!userId) throw new SystemQuestError('unauthorized', 'Missing user', 401);
  return { userId, authKind };
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof SystemQuestError) {
    res.status(err.status).json({
      success: false,
      error: err.code,
      message: err.message,
      ...(err.extra ?? {}),
    });
    return;
  }
  console.error('[SYSTEM]', err instanceof Error ? err.message : err);
  res.status(500).json({
    success: false,
    error: 'internal',
    message: err instanceof Error ? err.message : 'Unknown error',
  });
}

function requirePlayer(authKind: 'user' | 'service'): void {
  if (authKind === 'service') {
    throw new SystemQuestError(
      'service_key_scope',
      'Service credentials cannot manage credentials or approve money rewards',
      403,
    );
  }
}

router.post('/quests', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    const result = await createSystemQuest(userId, req.body ?? {}, authKind);
    res.status(result.created ? 201 : 200).json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/quests', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const includeHidden = req.query.includeHidden === 'true';
    if (status && !['active', 'cleared', 'failed', 'expired'].includes(status)) {
      throw new SystemQuestError('invalid_quest', 'status filter is invalid', 400);
    }
    const result = await listSystemQuests(userId, {
      status: status as 'active' | 'cleared' | 'failed' | 'expired' | undefined,
      includeHidden,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/quests/:id', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const quest = await getSystemQuest(userId, req.params.id, {
      includeHidden: req.query.includeHidden === 'true',
    });
    res.json({ success: true, quest });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/quests/:id/progress', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const result = await updateQuestProgress(userId, req.params.id, req.body ?? {});
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/quests/:id/budget', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const quest = await updateAcquisitionBudget(userId, req.params.id, req.body ?? {});
    res.json({ success: true, quest, xpApplied: [] });
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/quests/:id', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    const result = await correctSystemQuest(userId, req.params.id, req.body ?? {}, authKind);
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/quests/:id/clear', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    // XP is read from the stored quest. req.body.xp is intentionally ignored.
    const result = await resolveSystemQuest(userId, req.params.id, 'cleared');
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/quests/:id/fail', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const result = await resolveSystemQuest(userId, req.params.id, 'failed');
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/quests/:id/reveal', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const quest = await revealSystemQuest(userId, req.params.id);
    res.json({ success: true, quest });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/quests/:id/reward-approval', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    const quest = await decideRewardApproval(userId, req.params.id, req.body?.decision, authKind);
    res.json({ success: true, quest });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/messages', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    const result = await postSystemMessage(userId, req.body ?? {}, authKind);
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/consumption', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const result = await listConsumption(userId, date, { authKind: 'user' });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ConsumptionError) {
      res.status(err.status).json({ success: false, error: err.code, message: err.message });
      return;
    }
    sendError(res, err);
  }
});

router.patch('/consumption/:id', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    const key = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
    if (!key || key.length > 200 || /[\r\n]/.test(key)) {
      throw new ConsumptionError('invalid_consumption', 'idempotencyKey is required (1–200 characters)', 400);
    }
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const result = await correctConsumption(userId, req.params.id, {
      ...(req.body ?? {}),
      idempotencyKey: key,
      date: req.body?.date ?? date,
    }, { notifySystem: true, authKind });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ConsumptionError) {
      res.status(err.status).json({ success: false, error: err.code, message: err.message });
      return;
    }
    sendError(res, err);
  }
});

router.post('/consumption', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    const key = typeof req.body?.idempotencyKey === 'string' ? req.body.idempotencyKey.trim() : '';
    if (!key || key.length > 200 || /[\r\n]/.test(key)) {
      throw new SystemQuestError('invalid_consumption', 'idempotencyKey is required (1–200 characters)', 400);
    }
    const result = await logConsumption(userId, { ...(req.body ?? {}), idempotencyKey: key }, {
      notifySystem: true,
      authKind,
    });
    res.status(result.idempotentReplay ? 200 : 201).json({ success: true, ...result });
  } catch (err) {
    if (err instanceof ConsumptionError) {
      res.status(err.status).json({ success: false, error: err.code, message: err.message });
      return;
    }
    sendError(res, err);
  }
});

router.get('/messages', async (req: Request, res: Response) => {
  try {
    const { userId } = authOf(req);
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
    const messages = await listSystemMessages(userId, Number.isFinite(limit) ? limit : 50);
    res.json({ success: true, messages });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/credentials', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    requirePlayer(authKind);
    const result = await createServiceCredential(userId, req.body ?? {});
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/credentials', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    requirePlayer(authKind);
    const credentials = await listServiceCredentials(userId);
    res.json({ success: true, credentials });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/credentials/:id', async (req: Request, res: Response) => {
  try {
    const { userId, authKind } = authOf(req);
    requirePlayer(authKind);
    const credential = await revokeServiceCredential(userId, req.params.id);
    res.json({ success: true, credential });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
