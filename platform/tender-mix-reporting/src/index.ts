/**
 * platform/tender-mix-reporting (POS-02)
 *
 * Tender totals by type (cash/card/gift/comp) per session or shift.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('tender-mix-reporting');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  tenderTypes: z
    .array(z.string())
    .default(['cash', 'card', 'gift', 'comp', 'other']),
});

export interface TenderLine {
  id: string;
  tenantId: string;
  sessionId: string;
  shiftId: string | null;
  tenderType: string;
  amountCents: number;
  direction: 'sale' | 'refund';
  createdAt: string;
}

export interface TenderMixSummary {
  scope: { sessionId?: string; shiftId?: string };
  byType: Record<
    string,
    { salesCents: number; refundsCents: number; netCents: number }
  >;
  totalSalesCents: number;
  totalRefundsCents: number;
  netCents: number;
}

const lines = new Map<string, TenderLine>();

export function __resetTenderMixStore(): void {
  lines.clear();
}

export async function recordTender(
  tenantId: string,
  actorId: string,
  input: {
    sessionId: string;
    shiftId?: string;
    tenderType: string;
    amountCents: number;
    direction?: 'sale' | 'refund';
  },
): Promise<TenderLine> {
  return runCrudOperation({
    configName: 'tender-mix-reporting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('tender-mix-reporting', ConfigSchema);
      if (!input.sessionId?.trim()) {
        throw new AppError('sessionId required', ErrorCode.BAD_REQUEST);
      }
      const type = input.tenderType?.trim().toLowerCase();
      if (
        !type ||
        (config.tenderTypes.length > 0 &&
          !config.tenderTypes.map((t) => t.toLowerCase()).includes(type))
      ) {
        throw new AppError('invalid tenderType', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.amountCents !== 'number' || input.amountCents <= 0) {
        throw new AppError('amountCents must be positive', ErrorCode.BAD_REQUEST);
      }
      const direction = input.direction || 'sale';
      if (direction !== 'sale' && direction !== 'refund') {
        throw new AppError('invalid direction', ErrorCode.BAD_REQUEST);
      }
      const row: TenderLine = {
        id: crypto.randomUUID(),
        tenantId,
        sessionId: input.sessionId,
        shiftId: input.shiftId || null,
        tenderType: type,
        amountCents: input.amountCents,
        direction,
        createdAt: new Date().toISOString(),
      };
      lines.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'pos_tender_line',
    meterEventType: 'api_call',
  });
}

function summarize(rows: TenderLine[]): TenderMixSummary {
  const byType: TenderMixSummary['byType'] = {};
  let totalSalesCents = 0;
  let totalRefundsCents = 0;
  for (const r of rows) {
    if (!byType[r.tenderType]) {
      byType[r.tenderType] = {
        salesCents: 0,
        refundsCents: 0,
        netCents: 0,
      };
    }
    if (r.direction === 'sale') {
      byType[r.tenderType].salesCents += r.amountCents;
      totalSalesCents += r.amountCents;
    } else {
      byType[r.tenderType].refundsCents += r.amountCents;
      totalRefundsCents += r.amountCents;
    }
    byType[r.tenderType].netCents =
      byType[r.tenderType].salesCents - byType[r.tenderType].refundsCents;
  }
  return {
    scope: {},
    byType,
    totalSalesCents,
    totalRefundsCents,
    netCents: totalSalesCents - totalRefundsCents,
  };
}

export async function getSessionTenderMix(
  tenantId: string,
  actorId: string,
  sessionId: string,
): Promise<TenderMixSummary> {
  return runCrudOperation({
    configName: 'tender-mix-reporting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!sessionId?.trim()) {
        throw new AppError('sessionId required', ErrorCode.BAD_REQUEST);
      }
      const rows = [...lines.values()].filter(
        (l) => l.tenantId === tenantId && l.sessionId === sessionId,
      );
      const summary = summarize(rows);
      summary.scope = { sessionId };
      return summary;
    },
    auditAction: 'data.read',
    auditResource: 'pos_tender_line',
    meterEventType: 'api_call',
  });
}

export async function getShiftTenderMix(
  tenantId: string,
  actorId: string,
  shiftId: string,
): Promise<TenderMixSummary> {
  return runCrudOperation({
    configName: 'tender-mix-reporting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!shiftId?.trim()) {
        throw new AppError('shiftId required', ErrorCode.BAD_REQUEST);
      }
      const rows = [...lines.values()].filter(
        (l) => l.tenantId === tenantId && l.shiftId === shiftId,
      );
      const summary = summarize(rows);
      summary.scope = { shiftId };
      return summary;
    },
    auditAction: 'data.read',
    auditResource: 'pos_tender_line',
    meterEventType: 'api_call',
  });
}
