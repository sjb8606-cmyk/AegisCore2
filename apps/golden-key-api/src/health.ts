import { Router, Request, Response } from 'express';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, app: 'golden-key', version: process.env.SERVICE_VERSION || '0.1.0' });
});

export { router as healthRouter };
