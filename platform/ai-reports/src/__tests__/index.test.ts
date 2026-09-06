import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { createTemplate, buildPrompt, generateReport, getReportRun } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const TEMPLATE_ID = '33333333-3333-3333-3333-333333333333';
const RUN_ID = '44444444-4444-4444-4444-444444444444';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('buildPrompt', () => {
  it('interpolates real values from the data object into {{key}} placeholders', () => {
    const result = buildPrompt('Revenue for {{month}} was {{amount}}.', { month: 'March', amount: '$50k' });
    expect(result).toBe('Revenue for March was $50k.');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    const result = buildPrompt('{{name}} said hi. Regards, {{name}}.', { name: 'Sam' });
    expect(result).toBe('Sam said hi. Regards, Sam.');
  });

  it('leaves unmatched placeholders untouched when no data key is provided', () => {
    const result = buildPrompt('Value: {{missing}}', {});
    expect(result).toBe('Value: {{missing}}');
  });
});

describe('generateReport', () => {
  it('blocks when reports are disabled in config', async () => {
    mockConfig({ enabled: false, limits: { reportsPerMonth: 20 } });
    await expect(generateReport(TENANT_ID, USER_ID, { templateId: TEMPLATE_ID })).rejects.toThrow('AI Reports disabled');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('enforces the monthly report limit before loading a template', async () => {
    mockConfig({ enabled: true, limits: { reportsPerMonth: 5 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ count: '5' }]);

    await expect(generateReport(TENANT_ID, USER_ID, { templateId: TEMPLATE_ID })).rejects.toThrow(
      'Monthly report generation limits reached'
    );
    expect(withTenantQuery).toHaveBeenCalledTimes(1);
  });

  it('throws NOT_FOUND when the template does not exist for this tenant', async () => {
    mockConfig({ enabled: true, limits: { reportsPerMonth: 20 } });
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([]);

    await expect(generateReport(TENANT_ID, USER_ID, { templateId: TEMPLATE_ID })).rejects.toThrow(
      'Report template not found'
    );
  });

  // BUG — the function inserts a run with status 'processing', then runs a
  // second UPDATE that sets status to 'completed' and fills in result_body,
  // but returns the FIRST insert's row (result[0]), not the updated one.
  // Callers get back a stale object claiming the report is still processing,
  // even though the DB row is actually already completed.
  it('BUG: returns the stale "processing" row instead of the completed one', async () => {
    mockConfig({ enabled: true, limits: { reportsPerMonth: 20 } });
    const template = { id: TEMPLATE_ID, name: 'Q1 Summary', prompt_template: 'Revenue: {{revenue}}' };
    const staleInsertedRow = { id: RUN_ID, status: 'processing', result_body: null };

    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([template])
      .mockResolvedValueOnce([staleInsertedRow])
      .mockResolvedValueOnce([]);

    const result = await generateReport(TENANT_ID, USER_ID, { templateId: TEMPLATE_ID, inputData: { revenue: '$1M' } });

    expect(result.status).toBe('processing'); // documents the bug — should be 'completed'
    // TODO(ai-reports bug): change the UPDATE to `RETURNING *` and return that row instead.
  });

  it('sets a pdf file_url only when format is "pdf"', async () => {
    mockConfig({ enabled: true, limits: { reportsPerMonth: 20 } });
    const template = { id: TEMPLATE_ID, name: 'Report', prompt_template: 'x' };
    (withTenantQuery as any)
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([template])
      .mockResolvedValueOnce([{ id: RUN_ID }])
      .mockResolvedValueOnce([]);

    await generateReport(TENANT_ID, USER_ID, { templateId: TEMPLATE_ID, format: 'pdf', inputData: {} });

    const updateParams = (withTenantQuery as any).mock.calls[3][1];
    expect(updateParams[1]).toBe(`exports/${RUN_ID}.pdf`);
  });
});

describe('createTemplate', () => {
  it('blocks when reports are disabled', async () => {
    mockConfig({ enabled: false });
    await expect(createTemplate(TENANT_ID, { name: 'x', prompt_template: 'y' })).rejects.toThrow('AI Reports disabled');
  });

  it('creates a template and returns the inserted row', async () => {
    mockConfig({ enabled: true });
    const row = { id: 'tpl-1', name: 'Q1' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await createTemplate(TENANT_ID, { name: 'Q1', prompt_template: 'x' });
    expect(result).toEqual(row);
  });
});

describe('getReportRun', () => {
  it('returns the row for a given run id', async () => {
    const row = { id: RUN_ID, status: 'completed' };
    (withTenantQuery as any).mockResolvedValueOnce([row]);
    const result = await getReportRun(TENANT_ID, RUN_ID);
    expect(result).toEqual(row);
  });
});
