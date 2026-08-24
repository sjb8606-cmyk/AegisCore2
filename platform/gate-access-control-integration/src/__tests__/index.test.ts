import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn(() => ({
    enabled: true
  }))
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', async () => {
  class TestAppError extends Error {
    code: string;

    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }

  return {
    AppError: TestAppError,
    ErrorCode: {
      BAD_REQUEST: 'BAD_REQUEST',
      NOT_FOUND: 'NOT_FOUND',
      FORBIDDEN: 'FORBIDDEN',
      CONFLICT: 'CONFLICT'
    },
    runCrudOperation: async (args: {
      action: () => Promise<unknown>;
    }) => args.action()
  };
});

import {
  __resetGateAccessControlIntegrationStore,
  grantAccess,
  suspendAccessForNonpayment,
  logEntryEvent,
  getAccessRecord
} from '../index';

describe('gate-access-control-integration', () => {
  beforeEach(() => {
    __resetGateAccessControlIntegrationStore();
  });

  it('grants active access to a tenant holder', async () => {
    const access = await grantAccess(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-1',
      'GATE-1234'
    );

    expect(access.access_status).toBe('active');
    expect(access.access_code).toBe('GATE-1234');
  });

  it('suspends all access for nonpayment', async () => {
    await grantAccess(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-1',
      'GATE-1234'
    );

    const suspended = await suspendAccessForNonpayment(
      'tenant-1',
      'actor-1',
      'customer-1'
    );

    expect(suspended).toHaveLength(1);
    expect(suspended[0].access_status).toBe('suspended_nonpayment');
  });

  it('logs an entry event and updates the last entry timestamp', async () => {
    await grantAccess(
      'tenant-1',
      'actor-1',
      'customer-1',
      'unit-1',
      'GATE-1234'
    );

    const timestamp = '2026-08-23T12:00:00.000Z';

    const event = await logEntryEvent(
      'tenant-1',
      'actor-1',
      'customer-1',
      timestamp
    );

    expect(event.tenant_holder_id).toBe('customer-1');

    const access = getAccessRecord(
      'tenant-1',
      'customer-1',
      'unit-1'
    );

    expect(access?.last_entry_timestamp).toBe(timestamp);
  });
});
