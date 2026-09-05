/**
 * @platform/workflows
 * LIMITATION: throws plain Error (not AppError) for disabled / step limit.
 * LIMITATION: triggerWorkflow always marks execution 'completed' with no step runner.
 * BUG: createWorkflow reads data.steps.length with no guard → TypeError if steps missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
const mockLoadConfig = vi.fn();

vi.mock('../../utils/src/index', () => ({
  loadConfig: (...a: unknown[]) => mockLoadConfig(...a),
}));
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../metering/src/index', () => ({
  recordUsage: (...a: unknown[]) => mockRecordUsage(...a),
}));

import { createWorkflow, triggerWorkflow } from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const WF = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadConfig.mockReturnValue({
      enabled: true,
      limits: { workflowCount: 10, stepsPerWorkflow: 5 },
    });
  });

  it('createWorkflow throws plain Error when disabled (LIMITATION: not AppError)', async () => {
    mockLoadConfig.mockReturnValue({ enabled: false, limits: { workflowCount: 10, stepsPerWorkflow: 5 } });
    await expect(createWorkflow(TENANT, { name: 'N', trigger: { type: 'manual' }, steps: [] }))
      .rejects.toThrow(/Workflows disabled/);
  });

  it('createWorkflow throws when steps exceed limit', async () => {
    const steps = Array.from({ length: 6 }, (_, i) => ({ id: i }));
    await expect(createWorkflow(TENANT, {
      name: 'N', trigger: { type: 'manual' }, steps,
    })).rejects.toThrow(/Step limit exceeded/);
  });

  // BUG lock-in
  it('currently throws TypeError when steps is missing (BUG – should be validation error)', async () => {
    await expect(createWorkflow(TENANT, {
      name: 'N', trigger: { type: 'manual' },
    })).rejects.toThrow(TypeError);
  });

  it('createWorkflow inserts and returns row', async () => {
    const row = { id: WF, name: 'Onboard', trigger_type: 'manual' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createWorkflow(TENANT, {
      name: 'Onboard',
      trigger: { type: 'manual' },
      steps: [{ action: 'send_email' }],
    });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][1][2]).toBe('manual');
  });

  it('triggerWorkflow logs completed execution and meters (LIMITATION: no real step runner)', async () => {
    const exec = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
    mockWithTenantQuery.mockResolvedValueOnce([exec]);
    const result = await triggerWorkflow(TENANT, WF, { userId: 'u1' });
    expect(result).toEqual({
      executionId: exec.id,
      status: 'completed',
      message: 'Workflow executed successfully.',
    });
    expect(mockRecordUsage).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT,
      idempotencyKey: `wf:${exec.id}`,
    }));
  });
});
