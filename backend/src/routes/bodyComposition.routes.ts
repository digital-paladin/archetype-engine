import { Router, Request, Response } from 'express';
import { BodyCompositionError } from '../domain/bodyComposition';
import { listBodyComposition } from '../services/bodyComposition.service';

const router = Router();

function sendError(res: Response, err: unknown): void {
  if (err instanceof BodyCompositionError) {
    res.status(err.status).json({ success: false, error: err.code, message: err.message });
    return;
  }
  console.error('[BODY-COMPOSITION]', err instanceof Error ? err.message : err);
  res.status(500).json({
    success: false,
    error: 'internal',
    message: err instanceof Error ? err.message : 'Unknown error',
  });
}

// GET /api/body-composition — player session. Service keys cannot call this path.
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as Request & { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  try {
    const readings = await listBodyComposition(userId, req.query.limit);
    res.json({ success: true, readings });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
