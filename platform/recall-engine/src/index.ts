/**
 * platform/recall-engine/src/index.ts
 *
 * The single most-repeated gap across every research report on this
 * project: given a lot, instantly show everything upstream (supplier,
 * vessel, harvest data) and downstream (batches, shipments, customers).
 *
 * This is deliberately a thin orchestration layer, not a reimplementation.
 * The actual graph-walking already exists in LotTraceabilityService
 * (traceUpstream/traceDownstream, built on lot_relationships). Recall
 * Engine's job is to (1) shape that into a report, and (2) act on it —
 * specifically, cascade a hold from one lot to every lot downstream of it,
 * which is the real-world "a held raw lot must flag every batch that used
 * it" requirement flagged in the original gap analysis.
 */

import { z } from 'zod';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export const CascadeHoldInputSchema = z.object({
  reason: z.string().min(1),
});

export interface RecallReport {
  lot: any;
  upstream: any[];
  downstream: any[];
  upstreamCount: number;
  downstreamCount: number;
  generatedAt: string;
}

export interface CascadeHoldResultEntry {
  lotId: string;
  status: 'held' | 'failed';
  lot?: any;
  error?: string;
}

export interface CascadeHoldReport {
  sourceLotId: string;
  totalTargeted: number;
  heldCount: number;
  failedCount: number;
  results: CascadeHoldResultEntry[];
}

export class RecallEngineService {
  static async generateRecallReport(tenantId: string, lotId: string): Promise<RecallReport> {
    const [lot, upstream, downstream] = await Promise.all([
      LotTraceabilityService.getLot(tenantId, lotId),
      LotTraceabilityService.traceUpstream(tenantId, lotId),
      LotTraceabilityService.traceDownstream(tenantId, lotId),
    ]);

    return {
      lot,
      upstream,
      downstream,
      upstreamCount: upstream.length,
      downstreamCount: downstream.length,
      generatedAt: new Date().toISOString(),
    };
  }

  static async cascadeHold(
    tenantId: string,
    userId: string,
    lotId: string,
    data: any,
  ): Promise<CascadeHoldReport> {
    const input = CascadeHoldInputSchema.parse(data);

    const downstream = await LotTraceabilityService.traceDownstream(tenantId, lotId);
    const targetLotIds = Array.from(new Set([lotId, ...downstream.map((d: any) => d.id)]));

    const results: CascadeHoldResultEntry[] = [];
    for (const targetId of targetLotIds) {
      try {
        const held = await LotTraceabilityService.holdLot(tenantId, userId, targetId, {
          reason: input.reason,
        });
        results.push({ lotId: targetId, status: 'held', lot: held });
      } catch (err: any) {
        results.push({ lotId: targetId, status: 'failed', error: err.message });
      }
    }

    return {
      sourceLotId: lotId,
      totalTargeted: targetLotIds.length,
      heldCount: results.filter((r) => r.status === 'held').length,
      failedCount: results.filter((r) => r.status === 'failed').length,
      results,
    };
  }
}
