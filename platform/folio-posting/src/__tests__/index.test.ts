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
      defaultTaxBps: 1000,
      allowNegativeBalance: false,
    }),
  };
});
vi.mock('@platform/observability', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  openFolio,
  postCharge,
  postPayment,
  closeFolio,
  splitFolio,
  __resetFolioPostingStore,
} from '../index';

const tenantId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-0000000000aa';

describe('folio-posting', () => {
  beforeEach(() => {
    __resetFolioPostingStore();
    vi.clearAllMocks();
  });

  it('posts room charge with tax and pays to zero', async () => {
    const folio = await openFolio(tenantId, actorId, {
      reservationId: crypto.randomUUID(),
      guestName: 'Ada Lovelace',
    });
    const charged = await postCharge(tenantId, actorId, folio.id, {
      type: 'room',
      description: '1 night',
      amountCents: 10000,
      applyDefaultTax: true,
    });
    // 10000 + 10% tax = 11000
    expect(charged.balanceCents).toBe(11000);
    const paid = await postPayment(tenantId, actorId, folio.id, 11000);
    expect(paid.balanceCents).toBe(0);
    const closed = await closeFolio(tenantId, actorId, folio.id);
    expect(closed.status).toBe('closed');
  });

  it('blocks close with outstanding balance', async () => {
    const folio = await openFolio(tenantId, actorId, {
      reservationId: crypto.randomUUID(),
      guestName: 'Guest',
    });
    await postCharge(tenantId, actorId, folio.id, {
      type: 'minibar',
      description: 'Water',
      amountCents: 500,
    });
    await expect(closeFolio(tenantId, actorId, folio.id)).rejects.toThrow(
      /balance/i,
    );
  });

  it('splits lines onto a new folio', async () => {
    const folio = await openFolio(tenantId, actorId, {
      reservationId: crypto.randomUUID(),
      guestName: 'Primary',
    });
    const charged = await postCharge(tenantId, actorId, folio.id, {
      type: 'fnb',
      description: 'Dinner',
      amountCents: 4000,
    });
    const lineId = charged.lines[0].id;
    const { original, split } = await splitFolio(
      tenantId,
      actorId,
      folio.id,
      [lineId],
      'Secondary',
    );
    expect(original.lines).toHaveLength(0);
    expect(split.balanceCents).toBe(4000);
    expect(split.guestName).toBe('Secondary');
  });
});
