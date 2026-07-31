/**
 * Veridact v1.0 — OpenTelemetry Tracing Middleware
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';

let _tracer: any = null;

function getTracer() {
  if (!_tracer) {
    try {
      const { trace } = require('@opentelemetry/api');
      _tracer = trace.getTracer('veridact', process.env.npm_package_version ?? '1.0.0');
    } catch {
      _tracer = {
        startActiveSpan: <T>(name: string, fn: (span: any) => T): T => {
          const stub = {
            setAttribute: () => {},
            setStatus: () => {},
            recordException: () => {},
            end: () => {},
          };
          return fn(stub);
        },
      };
    }
  }
  return _tracer;
}

export function otelMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const spanName = `${req.method} ${req.route?.path ?? req.path}`;

  getTracer().startActiveSpan(spanName, (span: any) => {
    const authedReq = req as AuthenticatedRequest;

    span.setAttribute('http.method', req.method);
    span.setAttribute('http.target', req.path);
    span.setAttribute('http.user_agent', req.headers['user-agent'] ?? '');

    if (authedReq.actor) {
      span.setAttribute('actor.id', authedReq.actor.id);
      span.setAttribute('actor.type', authedReq.actor.type);
    }
    if (authedReq.tenantId) {
      span.setAttribute('tenant.id', authedReq.tenantId);
    }

    res.on('finish', () => {
      span.setAttribute('http.status_code', res.statusCode);
      if (res.statusCode >= 500) {
        span.setStatus({ code: 2, message: 'Internal Server Error' });
      } else if (res.statusCode >= 400) {
        span.setStatus({ code: 1, message: 'Client Error' });
      }
      span.end();
    });

    res.on('error', (err) => {
      span.recordException(err);
      span.setStatus({ code: 2, message: err.message });
      span.end();
    });

    next();
  });
}

export function addSpanAttributes(attrs: Record<string, string | boolean | number>): void {
  try {
    const { trace } = require('@opentelemetry/api');
    const span = trace.getActiveSpan();
    if (span) {
      for (const [k, v] of Object.entries(attrs)) {
        span.setAttribute(k, v);
      }
    }
  } catch {
    // OTel not configured — no-op
  }
}
