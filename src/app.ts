/**
 * Veridact v1.0 — Express Application
 */

import express from 'express';
import helmet from 'helmet';
import { otelMiddleware } from './middleware/otel';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { verifyRouter } from './routes/verify';
import { replayRouter } from './routes/replay';
import { readRouter } from './routes/read';
import { healthRouter } from './routes/health';
import { actionsRouter } from './routes/actions';
import { logger } from './db/logger';

export function createApp(): express.Application {
  const app = express();

  app.use(helmet());
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration_ms: Date.now() - start,
          tenant_id: (req as any).tenantId,
          actor_id: (req as any).actor?.id,
        },
        'http.request'
      );
    });
    next();
  });

  app.use(otelMiddleware);

  app.use('/v1/health', healthRouter);
  app.use('/v1/verify', verifyRouter);
  app.use('/v1/replay', replayRouter);
  app.use('/v1', readRouter);
  app.use('/v1', actionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
