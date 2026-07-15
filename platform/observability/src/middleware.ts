/**
 * platform/observability/src/middleware.ts
 *
 * Express middleware for request tracing + structured access logging + metrics.
 */

import { Request, Response, NextFunction } from 'express';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { getLogger } from './logger';
import {
  httpRequestDuration,
  httpRequestsTotal,
  httpErrorsTotal,
} from './metrics';

const logger = getLogger('observability:http');

export function observabilityMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startMs  = Date.now();
    const spanName = `${req.method} ${req.route?.path || req.path}`;

    // Attach request-scoped logger
    (req as any).log = logger.child({
      method:  req.method,
      path:    req.path,
      traceId: trace.getActiveSpan()?.spanContext().traceId,
    });

    res.on('finish', () => {
      const durationMs = Date.now() - startMs;
      const status     = res.statusCode;
      const labels     = {
        method: req.method,
        route:  req.route?.path || 'unknown',
        status: String(status),
      };

      // Metrics
      httpRequestDuration.record(durationMs, labels);
      httpRequestsTotal.add(1, labels);
      if (status >= 400) {
        httpErrorsTotal.add(1, labels);
      }

      // Structured access log
      const logFn = status >= 500 ? logger.error.bind(logger)
                  : status >= 400 ? logger.warn.bind(logger)
                  : logger.info.bind(logger);

      logFn({
        method:     req.method,
        path:       req.path,
        status,
        durationMs,
        ip:         req.ip,
        userAgent:  req.headers['user-agent'],
        tenantId:   (req as any).auth?.tenantId,
        sub:        (req as any).auth?.sub,
      }, 'HTTP request');

      // Update span status on error
      const span = trace.getActiveSpan();
      if (span && status >= 500) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${status}` });
      }
    });

    next();
  };
}
