/**
 * platform/fisheries/production-verifier/src/index.ts
 */

import { ingestEvent } from '../../../audit-log/src/index';
import { runIntegrityCheck } from '../../../verifier/src/index';
import { withTenantQuery } from '../../../tenancy/src/index';
import { AppError, ErrorCode } from '../../../utils/src/index';
export { AppError, ErrorCode };

function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

export class ProductionVerifierService {
  static async recordBatchCompletion(tenantId: string, userId: string, batch: any) {
    const cleanUserId = parseUserId(userId);

    return await ingestEvent(tenantId, {
      event_type: 'fisheries.batch_completed',
      actor_id: cleanUserId,
      actor_type: 'user',
      resource_type: 'processing_batch',
      resource_id: batch.id,
      action: 'complete',
      outcome: 'success',
      after_state: {
        species_id: batch.species_id,
        raw_input_weight_kg: batch.raw_input_weight_kg,
        finished_weight_kg: batch.finished_weight_kg,
        completed_at: batch.completed_at,
      },
    });
  }

  static async recordYieldComputation(tenantId: string, userId: string, yieldRecord: any) {
    const cleanUserId = parseUserId(userId);

    return await ingestEvent(tenantId, {
      event_type: 'fisheries.yield_computed',
      actor_id: cleanUserId,
      actor_type: 'user',
      resource_type: 'yield_record',
      resource_id: yieldRecord.id,
      action: 'compute',
      outcome: 'success',
      after_state: {
        batch_id: yieldRecord.batch_id,
        actual_yield_percent: yieldRecord.actual_yield_percent,
        is_underperforming: yieldRecord.is_underperforming,
      },
    });
  }

  static async verifyProductionIntegrity(tenantId: string) {
    return await runIntegrityCheck(tenantId);
  }

  static async getVerificationHistory(tenantId: string) {
    return await withTenantQuery(
      'SELECT * FROM integrity_checks WHERE tenant_id = $1 ORDER BY verified_at DESC LIMIT 50',
      [tenantId],
      tenantId
    );
  }
}
