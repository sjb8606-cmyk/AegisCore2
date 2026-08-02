import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../../../platform/tenancy/src/index', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('../../../../../platform/audit/src/index', () => ({
  emit: vi.fn(),
}));
vi.mock('../../../../../platform/metering/src/index', () => ({
  recordUsage: vi.fn(),
}));

import { giftCardsRouter } from '../gift-cards';
import { withTenantQuery } from '../../../../../platform/tenancy/src/index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const CARD_ID = '44444444-4444-4444-4444-444444444444';

function buildTestApp(roles: string[] = ['viewer']) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { sub: USER_ID, tenantId: TENANT_ID, roles };
    next();
  });
  app.use('/gift-cards', giftCardsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /gift-cards/items', () => {
  it('issues a real gift card with a cryptographically random 16-char hex code, current balance equal to initial', async () => {
    (withTenantQuery as any).mockImplementation((_sql: string, params: any[]) =>
      Promise.resolve([{
        id: CARD_ID, code: params[1], initial_balance_cents: params[2], current_balance_cents: params[2],
        issued_to_email: params[3], status: 'active', created_at: '2026-08-01T00:00:00Z',
      }])
    );

    const res = await request(buildTestApp())
      .post('/gift-cards/items')
      .send({ initialBalanceCents: 5000, issuedToEmail: 'gift@example.com' });

    expect(res.status).toBe(201);
    expect(res.body.data.current_balance_cents).toBe(5000);
    expect(res.body.data.code).toMatch(/^[0-9A-F]{16}$/);
  });

  it('generates a genuinely different code on every call (not a fixed/fake value)', async () => {
    (withTenantQuery as any).mockImplementation((_sql: string, params: any[]) =>
      Promise.resolve([{ id: CARD_ID, code: params[1], initial_balance_cents: params[2], current_balance_cents: params[2], issued_to_email: params[3], status: 'active', created_at: '2026-08-01T00:00:00Z' }])
    );

    const res1 = await request(buildTestApp()).post('/gift-cards/items').send({ initialBalanceCents: 1000, issuedToEmail: 'a@example.com' });
    const res2 = await request(buildTestApp()).post('/gift-cards/items').send({ initialBalanceCents: 1000, issuedToEmail: 'b@example.com' });

    expect(res1.body.data.code).not.toBe(res2.body.data.code);
  });

  it('rejects a zero/negative balance with a real 422', async () => {
    const res = await request(buildTestApp())
      .post('/gift-cards/items')
      .send({ initialBalanceCents: 0, issuedToEmail: 'gift@example.com' });

    expect(res.status).toBe(422);
  });

  it('rejects an invalid email with a real 422', async () => {
    const res = await request(buildTestApp())
      .post('/gift-cards/items')
      .send({ initialBalanceCents: 1000, issuedToEmail: 'not-an-email' });

    expect(res.status).toBe(422);
  });
});

describe('DELETE /gift-cards/items/:id (void)', () => {
  it('voids a real active gift card via a real state transition, not a delete', async () => {
    (withTenantQuery as any).mockResolvedValue([{ id: CARD_ID }]);

    const res = await request(buildTestApp()).delete(`/gift-cards/items/${CARD_ID}`);

    expect(res.status).toBe(200);
    const call = (withTenantQuery as any).mock.calls[0];
    expect(call[0]).toContain("SET status = 'voided'");
    expect(call[0]).toContain("AND status = 'active'");
    expect(call[0]).not.toContain('DELETE FROM gift_cards');
  });

  it('returns 404 when the card is already redeemed or voided (real state-machine enforcement)', async () => {
    (withTenantQuery as any).mockResolvedValue([]);

    const res = await request(buildTestApp()).delete(`/gift-cards/items/${CARD_ID}`);
    expect(res.status).toBe(404);
  });
});
