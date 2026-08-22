import { Router, Request, Response } from 'express';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'gateway',
    version: process.env.SERVICE_VERSION || '0.1.0',
    timestamp: new Date().toISOString(),
  });
});

export { router as healthRouter };
