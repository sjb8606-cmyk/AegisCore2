/**
 * Veridact v1.0 — Logger
 *
 * Thin shim over a structured pino logger. All log entries include service
 * name and version for log aggregation.
 */

import pino from 'pino';

export const logger = pino({
  name: 'veridact',
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'veridact',
    version: process.env.npm_package_version ?? 'unknown',
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {}),
});
