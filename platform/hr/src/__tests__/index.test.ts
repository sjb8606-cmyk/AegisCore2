import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

import { HrService } from '../index';
import { withTenantQuery } from '@platform/tenancy';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const EMPLOYEE_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
});

describe("HrService.clockIn — real table name, not the one legal's migration destroys", () => {
  it('reads and writes hr_time_entries, not the shared/colliding "time_entries" name', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM employees')) return Promise.resolve([{ id: EMPLOYEE_ID }]);
      if (sql.includes('hr_time_entries') && sql.includes('COUNT')) return Promise.resolve([{ count: 0 }]);
      return Promise.resolve([{ id: 'entry-1', employee_id: EMPLOYEE_ID }]);
    });

    await HrService.clockIn(TENANT_ID, EMPLOYEE_ID, { clockIn: new Date().toISOString(), notes: 'test' });

    const calls = (withTenantQuery as any).mock.calls;
    const touchedOldTable = calls.some((c: any[]) => typeof c[0] === 'string' && /\bFROM time_entries\b|\bINTO time_entries\b/.test(c[0]));
    const touchedRealTable = calls.some((c: any[]) => typeof c[0] === 'string' && c[0].includes('hr_time_entries'));

    expect(touchedOldTable).toBe(false);
    expect(touchedRealTable).toBe(true);
  });

  it('blocks a double clock-in for the same employee', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM employees')) return Promise.resolve([{ id: EMPLOYEE_ID }]);
      if (sql.includes('hr_time_entries') && sql.includes('COUNT')) return Promise.resolve([{ count: 1 }]);
      return Promise.resolve([]);
    });

    await expect(
      HrService.clockIn(TENANT_ID, EMPLOYEE_ID, { clockIn: new Date().toISOString() }),
    ).rejects.toThrow('already clocked in');
  });

  it('creates the real insert row and returns it', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM employees')) return Promise.resolve([{ id: EMPLOYEE_ID }]);
      if (sql.includes('COUNT')) return Promise.resolve([{ count: 0 }]);
      return Promise.resolve([{ id: 'entry-1', tenant_id: TENANT_ID, employee_id: EMPLOYEE_ID }]);
    });

    const result = await HrService.clockIn(TENANT_ID, EMPLOYEE_ID, { clockIn: new Date().toISOString() });
    expect(result.id).toBe('entry-1');
  });
});
