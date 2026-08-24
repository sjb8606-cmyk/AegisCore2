import * as crypto from 'crypto';
import { z } from 'zod';
import {
  AppError,
  ErrorCode,
  runCrudOperation
} from '@platform/crud-kernel';

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true)
});

const OrderSchema = z.object({
  orderId: z.string().uuid(),
  tenantId: z.string().uuid(),
  diagnosisId: z.string().uuid(),
  partNumber: z.string().min(1).max(200),
  partDescription: z.string().min(1).max(500),
  cost: z.number().nonnegative(),
  coveredByWarranty: z.boolean(),
  orderStatus: z.enum([
    'ordered',
    'backordered',
    'received',
    'installed'
  ]),
  warrantyClaimId: z.string().uuid().nullable(),
  createdAt: z.string().datetime()
});

export type PartsOrder = z.infer<typeof OrderSchema>;

const orderStore = new Map<string, PartsOrder>();

export function __resetPartsOrderWarrantyClaimStore(): void {
  orderStore.clear();
}

export async function orderPart(
  tenantId: string,
  actorId: string,
  diagnosisId: string,
  partNumber: string,
  partDescription: string,
  cost: number
): Promise<PartsOrder> {
  return runCrudOperation({
    configName: 'parts-order-warranty-claim',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!partNumber.trim() || !partDescription.trim()) {
        throw new AppError(
          'Part number and description are required',
          ErrorCode.BAD_REQUEST
        );
      }

      if (!Number.isFinite(cost) || cost < 0) {
        throw new AppError(
          'Part cost must be non-negative',
          ErrorCode.BAD_REQUEST
        );
      }

      const order = OrderSchema.parse({
        orderId: crypto.randomUUID(),
        tenantId,
        diagnosisId,
        partNumber: partNumber.trim(),
        partDescription: partDescription.trim(),
        cost,
        coveredByWarranty: false,
        orderStatus: 'ordered',
        warrantyClaimId: null,
        createdAt: new Date().toISOString()
      });

      orderStore.set(order.orderId, order);
      return order;
    },
    auditAction: 'data.created',
    auditResource: 'parts_order',
    meterEventType: 'api_call'
  });
}

export async function fileWarrantyClaim(
  tenantId: string,
  actorId: string,
  orderId: string
): Promise<PartsOrder> {
  return runCrudOperation({
    configName: 'parts-order-warranty-claim',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const order = orderStore.get(orderId);

      if (!order) {
        throw new AppError(
          'Parts order not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (order.tenantId !== tenantId) {
        throw new AppError(
          'Parts order does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      const updated = OrderSchema.parse({
        ...order,
        coveredByWarranty: true,
        warrantyClaimId: crypto.randomUUID()
      });

      orderStore.set(orderId, updated);
      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'parts_order_warranty_claim',
    meterEventType: 'api_call'
  });
}

export async function updateOrderStatus(
  tenantId: string,
  actorId: string,
  orderId: string,
  status: PartsOrder['orderStatus']
): Promise<PartsOrder> {
  return runCrudOperation({
    configName: 'parts-order-warranty-claim',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const order = orderStore.get(orderId);

      if (!order) {
        throw new AppError(
          'Parts order not found',
          ErrorCode.NOT_FOUND
        );
      }

      if (order.tenantId !== tenantId) {
        throw new AppError(
          'Parts order does not belong to tenant',
          ErrorCode.FORBIDDEN
        );
      }

      const updated = OrderSchema.parse({
        ...order,
        orderStatus: status
      });

      orderStore.set(orderId, updated);
      return updated;
    },
    auditAction: 'data.updated',
    auditResource: 'parts_order',
    meterEventType: 'api_call'
  });
}
