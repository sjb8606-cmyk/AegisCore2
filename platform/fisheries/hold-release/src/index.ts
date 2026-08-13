/**
 * platform/fisheries/hold-release/src/index.ts
 *
 * From the original gap analysis: Product Hold/Release "currently just a
 * thin flag inside yield-engine, not a real workflow. Needs: hold reason,
 * investigation, decision, and propagation (a held raw lot must flag
 * every batch that used it)."
 *
 * The propagation half already exists — RecallEngineService.cascadeHold
 * holds a lot and everything downstream of it. This module adds the
 * missing formal layer on top: a categorized reason, an investigation
 * record someone can be held accountable for, and a real decision
 * (release / destroy / rework) instead of releaseLot being callable by
 * anyone with no trail of why.
 *
 * Deliberately narrow scope: a 'destroy' or 'rework' decision resolves the
 * investigation but does NOT release the held lots — this module doesn't
 * pretend to model physical destruction or rework, which is real
 * plant-floor work outside a traceability system's scope. Only 'release'
 * actually calls back into LotTraceabilityService to lift the hold, and it
 * does so for every lot that was held when the investigation opened —
 * propagation applies symmetrically to release, not just to hold.
 */

import { z } from 'zod';
import { withTenant, withTenantQuery } from '@platform/tenancy';
import { LotTraceabilityService } from '@platform/lot-traceability';
import { RecallEngineService } from '@platform/recall-engine';
import { AppError, ErrorCode } from '@platform/utils';
export { AppError, ErrorCode };

export const ReasonCategorySchema = z.enum([
  'contamination',
  'temperature_deviation',
  'quality_defect',
  'regulatory',
  'other',
]);

export const OpenInvestigationInputSchema = z.object({
  reasonCategory: ReasonCategorySchema,
  reasonDetail: z.string().min(1),
});

export const ResolutionSchema = z.enum(['release', 'destroy', 'rework']);

export const ResolveInvestigationInputSchema = z.object({
  resolution: ResolutionSchema,
  findings: z.string().min(1),
});

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class HoldReleaseService {
  static async openInvestigation(tenantId: string, userId: string, lotId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = OpenInvestigationInputSchema.parse(data);

    const holdReport = await RecallEngineService.cascadeHold(tenantId, cleanUserId, lotId, {
      reason: `${input.reasonCategory}: ${input.reasonDetail}`,
    });

    const heldLotIds = holdReport.results.filter((r) => r.status === 'held').map((r) => r.lotId);

    const investigation = await withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `INSERT INTO hold_investigations (
          tenant_id, lot_id, reason_category, reason_detail, held_lot_ids,
          status, opened_by
        ) VALUES ($1, $2, $3, $4, $5, 'open', $6)
        RETURNING *`,
        [
          tenantId,
          lotId,
          input.reasonCategory,
          input.reasonDetail,
          JSON.stringify(heldLotIds),
          cleanUserId,
        ],
      );
      return res.rows[0];
    });

    return { investigation, holdReport };
  }

  static async getInvestigation(tenantId: string, investigationId: string) {
    const res = await withTenantQuery(
      `SELECT * FROM hold_investigations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, investigationId],
      tenantId,
    );
    if (!res || res.length === 0) {
      throw new AppError(`Investigation ${investigationId} not found`, ErrorCode.NOT_FOUND);
    }
    return res[0];
  }

  static async listOpenInvestigations(tenantId: string) {
    return withTenantQuery(
      `SELECT * FROM hold_investigations WHERE tenant_id = $1 AND status = 'open' ORDER BY opened_at DESC`,
      [tenantId],
      tenantId,
    );
  }

  static async resolveInvestigation(tenantId: string, userId: string, investigationId: string, data: any) {
    const cleanUserId = parseUserId(userId);
    const input = ResolveInvestigationInputSchema.parse(data);

    const existing = await this.getInvestigation(tenantId, investigationId);
    if (existing.status !== 'open') {
      throw new AppError(`Investigation ${investigationId} is already resolved`, ErrorCode.CONFLICT);
    }

    let releaseResults: Array<{ lotId: string; status: 'released' | 'failed'; error?: string }> = [];

    if (input.resolution === 'release') {
      const heldLotIds: string[] =
        typeof existing.held_lot_ids === 'string' ? JSON.parse(existing.held_lot_ids) : existing.held_lot_ids;

      for (const lotId of heldLotIds) {
        try {
          await LotTraceabilityService.releaseLot(tenantId, cleanUserId, lotId);
          releaseResults.push({ lotId, status: 'released' });
        } catch (err: any) {
          releaseResults.push({ lotId, status: 'failed', error: err.message });
        }
      }
    }

    const investigation = await withTenant(tenantId, async (client: any) => {
      const res = await client.query(
        `UPDATE hold_investigations
         SET status = 'resolved', resolution = $1, findings = $2, resolved_by = $3, resolved_at = NOW()
         WHERE tenant_id = $4 AND id = $5
         RETURNING *`,
        [input.resolution, input.findings, cleanUserId, tenantId, investigationId],
      );
      return res.rows[0];
    });

    return { investigation, releaseResults };
  }
}
