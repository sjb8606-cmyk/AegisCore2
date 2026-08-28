/**
 * platform/void-comp-audit (REST-04)
 *
 * Manager-authorized voids/comps with reason codes and shift reporting.
 * PIN check is injectable — real auth stays in identity layer.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('void-comp-audit');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  requireManagerPin: z.boolean().default(true),
  requireReason: z.boolean().default(true),
  maxCompCentsWithoutDualAuth: z.number().int().nonnegative().default(5000),
  reasonCodes: z
    .array(z.string())
    .default([
      'wrong_item',
      'quality',
      'guest_complaint',
      'staff_meal',
      'training',
      'other',
    ]),
});

export type AdjustmentType = 'void' | 'comp';

export interface AdjustmentEvent {
  id: string;
  tenantId: string;
  orderId: string;
  type: AdjustmentType;
  amountCents: number;
  reasonCode: string;
  notes: string | null;
  serverId: string;
  managerId: string;
  shiftId: string | null;
  createdAt: string;
}

/** Injectable manager PIN verifier */
type PinVerifier = (
  tenantId: string,
  managerId: string,
  pin: string,
) => Promise<boolean>;

const events = new Map<string, AdjustmentEvent>();
let pinVerifier: PinVerifier = async () => true;

export function __resetVoidCompAuditStore(): void {
  events.clear();
  pinVerifier = async () => true;
}

export function setManagerPinVerifier(fn: PinVerifier): void {
  pinVerifier = fn;
}

export async function recordVoid(
  tenantId: string,
  actorId: string,
  input: {
    orderId: string;
    amountCents: number;
    reasonCode: string;
    notes?: string;
    serverId: string;
    managerId: string;
    managerPin?: string;
    shiftId?: string;
  },
): Promise<AdjustmentEvent> {
  return recordAdjustment(tenantId, actorId, { ...input, type: 'void' });
}

export async function recordComp(
  tenantId: string,
  actorId: string,
  input: {
    orderId: string;
    amountCents: number;
    reasonCode: string;
    notes?: string;
    serverId: string;
    managerId: string;
    managerPin?: string;
    shiftId?: string;
  },
): Promise<AdjustmentEvent> {
  return recordAdjustment(tenantId, actorId, { ...input, type: 'comp' });
}

async function recordAdjustment(
  tenantId: string,
  actorId: string,
  input: {
    type: AdjustmentType;
    orderId: string;
    amountCents: number;
    reasonCode: string;
    notes?: string;
    serverId: string;
    managerId: string;
    managerPin?: string;
    shiftId?: string;
  },
): Promise<AdjustmentEvent> {
  return runCrudOperation({
    configName: 'void-comp-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('void-comp-audit', ConfigSchema);

      if (!input.orderId?.trim() || !input.serverId?.trim() || !input.managerId?.trim()) {
        throw new AppError(
          'orderId, serverId, managerId required',
          ErrorCode.BAD_REQUEST,
        );
      }
      if (typeof input.amountCents !== 'number' || input.amountCents <= 0) {
        throw new AppError('amountCents must be positive', ErrorCode.BAD_REQUEST);
      }
      const reason = input.reasonCode?.trim().toLowerCase();
      if (config.requireReason && !reason) {
        throw new AppError('reasonCode required', ErrorCode.BAD_REQUEST);
      }
      if (
        config.reasonCodes.length > 0 &&
        reason &&
        !config.reasonCodes.map((r) => r.toLowerCase()).includes(reason)
      ) {
        throw new AppError('invalid reasonCode', ErrorCode.BAD_REQUEST);
      }

      if (config.requireManagerPin) {
        if (!input.managerPin) {
          throw new AppError('managerPin required', ErrorCode.FORBIDDEN);
        }
        const ok = await pinVerifier(tenantId, input.managerId, input.managerPin);
        if (!ok) {
          throw new AppError('Invalid manager PIN', ErrorCode.FORBIDDEN);
        }
      }

      const event: AdjustmentEvent = {
        id: crypto.randomUUID(),
        tenantId,
        orderId: input.orderId,
        type: input.type,
        amountCents: input.amountCents,
        reasonCode: reason || 'other',
        notes: input.notes?.trim() || null,
        serverId: input.serverId,
        managerId: input.managerId,
        shiftId: input.shiftId || null,
        createdAt: new Date().toISOString(),
      };
      events.set(event.id, event);
      logger.info(
        {
          type: event.type,
          orderId: event.orderId,
          amountCents: event.amountCents,
          managerId: event.managerId,
        },
        'Void/comp recorded',
      );
      return event;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'rest_void_comp',
    meterEventType: 'api_call',
  });
}

export async function getShiftAdjustmentReport(
  tenantId: string,
  actorId: string,
  shiftId: string,
): Promise<{
  shiftId: string;
  voids: AdjustmentEvent[];
  comps: AdjustmentEvent[];
  totalVoidCents: number;
  totalCompCents: number;
}> {
  return runCrudOperation({
    configName: 'void-comp-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!shiftId?.trim()) {
        throw new AppError('shiftId required', ErrorCode.BAD_REQUEST);
      }
      const rows = [...events.values()].filter(
        (e) => e.tenantId === tenantId && e.shiftId === shiftId,
      );
      const voids = rows.filter((e) => e.type === 'void');
      const comps = rows.filter((e) => e.type === 'comp');
      return {
        shiftId,
        voids,
        comps,
        totalVoidCents: voids.reduce((s, e) => s + e.amountCents, 0),
        totalCompCents: comps.reduce((s, e) => s + e.amountCents, 0),
      };
    },
    auditAction: 'data.read',
    auditResource: 'rest_void_comp',
    meterEventType: 'api_call',
  });
}

export async function listOrderAdjustments(
  tenantId: string,
  actorId: string,
  orderId: string,
): Promise<AdjustmentEvent[]> {
  return runCrudOperation({
    configName: 'void-comp-audit',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...events.values()]
        .filter((e) => e.tenantId === tenantId && e.orderId === orderId)
        .sort(
          (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
        ),
    auditAction: 'data.read',
    auditResource: 'rest_void_comp',
    meterEventType: 'api_call',
  });
}
