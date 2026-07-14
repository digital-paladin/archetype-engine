import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { requireTier } from '../middleware/requireTier.middleware';

const router = Router();

/**
 * POST /api/ai/narrative-summary
 * Shadow Monarch gate — stub until LLM wiring (S3 feature-gate proof).
 */
router.post(
  '/narrative-summary',
  authMiddleware,
  requireTier('shadow_monarch'),
  async (req: Request, res: Response) => {
    const date = typeof req.body?.date === 'string'
      ? req.body.date
      : new Date().toLocaleDateString('en-CA');

    return res.json({
      success: true,
      stub: true,
      date,
      summary:
        'The System observes: your chronicle awaits a true Shadow Monarch narrative engine. '
        + 'This endpoint is live and tier-gated; wire OpenAI/Ollama in a later pack.',
    });
  },
);

export default router;
