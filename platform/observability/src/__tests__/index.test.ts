/**
 * @platform/observability
 * LIMITATION (tracing.ts): NodeSDK starts at module load — mocked so import is safe.
 * BUG (middleware.ts): spanName is computed but never used.
 * LIMITATION: OTel instruments are no-ops without a MeterProvider; we assert call shapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// vi.mock() factories are hoisted above the whole file, so any consts they
// reference must be declared via vi.hoisted() to avoid a TDZ ReferenceError.
const { mockChild, mockInfo, mockWarn, mockError, mockRootLogger } = vi.hoisted(() => {
  const mockChild = vi.fn();
  const mockInfo = vi.fn();
  const mockWarn = vi.fn();
  const mockError = vi.fn();
  const mockRootLogger = { child: mockChild, info: mockInfo, warn: mockWarn, error: mockError, level: 'info' };
  mockChild.mockReturnValue({ info: mockInfo, warn: mockWarn, error: mockError, child: mockChild });
  return { mockChild, mockInfo, mockWarn, mockError, mockRootLogger };
});

vi.mock('pino', () => {
  const pinoFn = vi.fn(() => mockRootLogger);
  (pinoFn as any).stdTimeFunctions = { isoTime: () => ',"time":"2026-01-01T00:00:00.000Z"' };
  return { default: pinoFn, stdTimeFunctions: (pinoFn as any).stdTimeFunctions };
});

const mockSpanContext = { traceId: 'aabbccddeeff00112233445566778899', spanId: '0011223344556677' };
const mockActiveSpan = { spanContext: () => mockSpanContext, setStatus: vi.fn() };
const mockTracer = { startSpan: vi.fn() };
const mockGetTracer = vi.fn(() => mockTracer);
const mockGetActiveSpan = vi.fn(() => mockActiveSpan);

vi.mock('@opentelemetry/api', () => ({
  trace: {
    getActiveSpan: (...a: unknown[]) => mockGetActiveSpan(...a),
    getTracer: (...a: unknown[]) => mockGetTracer(...a),
  },
  context: {},
  SpanStatusCode: { ERROR: 2, OK: 1, UNSET: 0 },
  metrics: {
    getMeter: () => ({
      createHistogram: (name: string) => ({ record: vi.fn(), name }),
      createCounter: (name: string) => ({ add: vi.fn(), name }),
      createUpDownCounter: (name: string) => ({ add: vi.fn(), name }),
    }),
  },
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: vi.fn().mockImplementation(() => ({ start: vi.fn(), shutdown: vi.fn() })),
}));
vi.mock('@opentelemetry/resources', () => ({
  Resource: vi.fn().mockImplementation((attrs) => ({ attributes: attrs })),
}));
vi.mock('@opentelemetry/instrumentation-http', () => ({ HttpInstrumentation: vi.fn() }));
vi.mock('@opentelemetry/instrumentation-express', () => ({ ExpressInstrumentation: vi.fn() }));

import {
  getLogger, logger, observabilityMiddleware, getTracer,
  httpRequestDuration, httpRequestsTotal, httpErrorsTotal, meter,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SUB = '22222222-2222-2222-2222-222222222222';

describe('observability / logger', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockChild.mockReturnValue({ info: mockInfo, warn: mockWarn, error: mockError, child: mockChild });
  });

  it('getLogger returns a child bound to the module name', () => {
    const log = getLogger('payments:intent');
    expect(mockChild).toHaveBeenCalledWith({ module: 'payments:intent' });
    expect(typeof log.info).toBe('function');
  });

  it('exports the root logger instance', () => {
    expect(logger).toBe(mockRootLogger);
  });
});

describe('observability / metrics + tracer', () => {
  it('exports named instruments and meter', () => {
    expect(httpRequestDuration).toBeDefined();
    expect(httpRequestsTotal).toBeDefined();
    expect(httpErrorsTotal).toBeDefined();
    expect(meter).toBeDefined();
  });

  it('getTracer delegates to OTel API', () => {
    const t = getTracer('veridact');
    expect(mockGetTracer).toHaveBeenCalledWith('veridact');
    expect(t).toBe(mockTracer);
  });
});

describe('observability / middleware', () => {
  function makeReqRes(overrides: Partial<Request> = {}) {
    const listeners: Record<string, Function[]> = {};
    const res = {
      statusCode: 200,
      on: (event: string, fn: Function) => { (listeners[event] ||= []).push(fn); },
      emit: (event: string) => { (listeners[event] || []).forEach((fn) => fn()); },
    } as unknown as Response & { emit: (e: string) => void };
    const req = {
      method: 'GET', path: '/api/v1/health', route: { path: '/health' },
      ip: '127.0.0.1', headers: { 'user-agent': 'vitest' },
      auth: { tenantId: TENANT, sub: SUB }, ...overrides,
    } as unknown as Request;
    return { req, res };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    (httpRequestDuration as any).record = vi.fn();
    (httpRequestsTotal as any).add = vi.fn();
    (httpErrorsTotal as any).add = vi.fn();
    mockChild.mockReturnValue({ info: mockInfo, warn: mockWarn, error: mockError, child: mockChild });
  });

  it('attaches request-scoped logger and calls next()', () => {
    const { req, res } = makeReqRes();
    const next = vi.fn() as NextFunction;
    observabilityMiddleware()(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect((req as any).log).toBeDefined();
    expect(mockChild).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET', path: '/api/v1/health', traceId: mockSpanContext.traceId,
    }));
  });

  it('2xx: records duration+total, info-logs, no error counter', () => {
    const { req, res } = makeReqRes();
    observabilityMiddleware()(req, res, vi.fn() as NextFunction);
    (res as any).statusCode = 200;
    (res as any).emit('finish');
    expect((httpRequestDuration as any).record).toHaveBeenCalledWith(
      expect.any(Number), expect.objectContaining({ method: 'GET', route: '/health', status: '200' }),
    );
    expect((httpRequestsTotal as any).add).toHaveBeenCalledWith(1, expect.objectContaining({ status: '200' }));
    expect((httpErrorsTotal as any).add).not.toHaveBeenCalled();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, tenantId: TENANT, sub: SUB, durationMs: expect.any(Number) }),
      'HTTP request',
    );
  });

  it('4xx: increments error counter and warn-logs', () => {
    const { req, res } = makeReqRes();
    observabilityMiddleware()(req, res, vi.fn() as NextFunction);
    (res as any).statusCode = 404;
    (res as any).emit('finish');
    expect((httpErrorsTotal as any).add).toHaveBeenCalledWith(1, expect.objectContaining({ status: '404' }));
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }), 'HTTP request');
  });

  it('5xx: error-logs and sets span status ERROR', () => {
    const { req, res } = makeReqRes();
    observabilityMiddleware()(req, res, vi.fn() as NextFunction);
    (res as any).statusCode = 500;
    (res as any).emit('finish');
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ status: 500 }), 'HTTP request');
    expect(mockActiveSpan.setStatus).toHaveBeenCalledWith({ code: 2, message: 'HTTP 500' });
  });

  it('falls back to route "unknown" when req.route is missing', () => {
    const { req, res } = makeReqRes({ route: undefined } as any);
    observabilityMiddleware()(req, res, vi.fn() as NextFunction);
    (res as any).statusCode = 200;
    (res as any).emit('finish');
    expect((httpRequestsTotal as any).add).toHaveBeenCalledWith(
      1, expect.objectContaining({ route: 'unknown', status: '200' }),
    );
  });
});
