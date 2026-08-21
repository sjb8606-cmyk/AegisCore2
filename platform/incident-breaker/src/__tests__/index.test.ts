import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/audit', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      enabled: true,
      autoSuspendSeverities: ['HIGH', 'CRITICAL'],
      alertChannels: ['log'],
    }),
  };
});

vi.mock('@platform/liability-contracts', () => ({
  getContract: vi.fn().mockResolvedValue({
    id: '00000000-0000-4000-8000-0000000000c1',
    tenantId: '00000000-0000-4000-8000-000000000001',
    status: 'active',
  }),
  setContractStatus: vi.fn().mockResolvedValue({ status: 'incident' }),
}));

vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  fileIncident,
  triageIncident,
  isActorSuspended,
  __resetIncidentBreakerStore,
} from '../index';
import { setContractStatus } from '@platform/liability-contracts';

const tenantId = '00000000-0000-4000-8000-000000000001';
const reporterId = '00000000-0000-4000-8000-0000000000aa';
const subjectId = '00000000-0000-4000-8000-0000000000bb';
const contractId = '00000000-0000-4000-8000-0000000000c1';

describe('incident-breaker', () => {
  beforeEach(() => {
    __resetIncidentBreakerStore();
    vi.clearAllMocks();
  });

  it('files LOW incident without suspend', async () => {
    const inc = await fileIncident(tenantId, reporterId, {
      contractId,
      subjectActorId: subjectId,
      severity: 'LOW',
      description: 'Minor scratch',
    });
    expect(inc.autoSuspended).toBe(false);
    expect(isActorSuspended(tenantId, subjectId)).toBe(false);
  });

  it('auto-suspends on CRITICAL', async () => {
    const inc = await fileIncident(tenantId, reporterId, {
      contractId,
      subjectActorId: subjectId,
      severity: 'CRITICAL',
      description: 'Serious injury',
    });
    expect(inc.autoSuspended).toBe(true);
    expect(isActorSuspended(tenantId, subjectId)).toBe(true);
    expect(setContractStatus).toHaveBeenCalled();
  });

  it('triage updates status', async () => {
    const inc = await fileIncident(tenantId, reporterId, {
      severity: 'MEDIUM',
      description: 'Late pickup',
    });
    const updated = await triageIncident(
      tenantId,
      reporterId,
      inc.id,
      'investigating',
    );
    expect(updated.triageStatus).toBe('investigating');
  });
});
