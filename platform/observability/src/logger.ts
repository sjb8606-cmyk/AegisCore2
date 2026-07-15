import pino, { Logger, LoggerOptions } from 'pino';
import { trace } from '@opentelemetry/api';

const REDACT_PATHS = [
  'password',
  'token',
  'secret',
  'authorization',
  'apiKey',
  'ssn',
  'req.headers.authorization',
  'req.headers.cookie'
];

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || 'info',
  base: {
    service: process.env.SERVICE_NAME || 'platform-core',
    env: process.env.NODE_ENV || 'development',
  },
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

function otelMixin() {
  const span = trace.getActiveSpan();
  if (!span) return {};
  const { traceId, spanId } = span.spanContext();
  return { traceId, spanId };
}

const rootLogger: Logger = pino({
  ...baseOptions,
  mixin: otelMixin,
});

export function getLogger(module: string): Logger {
  return rootLogger.child({ module });
}

export { rootLogger as logger };
