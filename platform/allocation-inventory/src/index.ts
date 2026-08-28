/**
 * platform/allocation-inventory (EC-01)
 *
 * Soft-reserve stock on cart, TTL expiry, commit on order.
 * Available = onHand - reserved (active).
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('allocation-inventory');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTtlSeconds: z.number().int().positive().default(900),
  allowOversell: z.boolean().default(false),
});

export interface StockLevel {
  tenantId: string;
  sku: string;
  onHand: number;
}

export interface Reservation {
  id: string;
  tenantId: string;
  cartId: string;
  sku: string;
  quantity: number;
  expiresAt: string;
  status: 'active' | 'committed' | 'released' | 'expired';
  createdAt: string;
}

const stock = new Map<string, StockLevel>();
const reservations = new Map<string, Reservation>();

export function __resetAllocationInventoryStore(): void {
  stock.clear();
  reservations.clear();
}

function stockKey(tenantId: string, sku: string): string {
  return tenantId + ':' + sku;
}

function nowMs(): number {
  return Date.now();
}

function expireStale(tenantId: string, sku?: string): void {
  const now = nowMs();
  for (const [id, r] of reservations) {
    if (r.tenantId !== tenantId) continue;
    if (sku && r.sku !== sku) continue;
    if (r.status === 'active' && Date.parse(r.expiresAt) <= now) {
      r.status = 'expired';
      reservations.set(id, r);
    }
  }
}

function activeReserved(tenantId: string, sku: string): number {
  expireStale(tenantId, sku);
  let sum = 0;
  for (const r of reservations.values()) {
    if (
      r.tenantId === tenantId &&
      r.sku === sku &&
      r.status === 'active'
    ) {
      sum += r.quantity;
    }
  }
  return sum;
}

function available(tenantId: string, sku: string): number {
  const s = stock.get(stockKey(tenantId, sku));
  const onHand = s?.onHand ?? 0;
  return onHand - activeReserved(tenantId, sku);
}

export async function setOnHand(
  tenantId: string,
  actorId: string,
  sku: string,
  onHand: number,
): Promise<StockLevel> {
  return runCrudOperation({
    configName: 'allocation-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!sku?.trim()) {
        throw new AppError('sku required', ErrorCode.BAD_REQUEST);
      }
      if (typeof onHand !== 'number' || onHand < 0) {
        throw new AppError('onHand must be >= 0', ErrorCode.BAD_REQUEST);
      }
      const row: StockLevel = {
        tenantId,
        sku: sku.trim(),
        onHand,
      };
      stock.set(stockKey(tenantId, row.sku), row);
      return row;
    },
    auditAction: 'data.updated',
    auditResource: 'ec_stock_level',
    meterEventType: 'api_call',
  });
}

export async function reserve(
  tenantId: string,
  actorId: string,
  input: {
    cartId: string;
    sku: string;
    quantity: number;
    ttlSeconds?: number;
  },
): Promise<Reservation> {
  return runCrudOperation({
    configName: 'allocation-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('allocation-inventory', ConfigSchema);
      if (!input.cartId?.trim() || !input.sku?.trim()) {
        throw new AppError('cartId and sku required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.quantity !== 'number' || input.quantity <= 0) {
        throw new AppError('quantity must be positive', ErrorCode.BAD_REQUEST);
      }
      const sku = input.sku.trim();
      expireStale(tenantId, sku);
      const avail = available(tenantId, sku);
      if (input.quantity > avail && !config.allowOversell) {
        throw new AppError(
          'Insufficient available inventory',
          ErrorCode.CONFLICT,
        );
      }
      const ttl = input.ttlSeconds ?? config.defaultTtlSeconds;
      const reservation: Reservation = {
        id: crypto.randomUUID(),
        tenantId,
        cartId: input.cartId,
        sku,
        quantity: input.quantity,
        expiresAt: new Date(nowMs() + ttl * 1000).toISOString(),
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      reservations.set(reservation.id, reservation);
      return reservation;
    },
    auditAction: 'data.created',
    auditResource: 'ec_reservation',
    meterEventType: 'api_call',
  });
}

export async function releaseExpired(
  tenantId: string,
  actorId: string,
): Promise<{ released: number }> {
  return runCrudOperation({
    configName: 'allocation-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      let released = 0;
      const now = nowMs();
      for (const [id, r] of reservations) {
        if (r.tenantId !== tenantId) continue;
        if (r.status === 'active' && Date.parse(r.expiresAt) <= now) {
          r.status = 'expired';
          reservations.set(id, r);
          released += 1;
        }
      }
      logger.info({ tenantId, released }, 'Expired reservations released');
      return { released };
    },
    auditAction: 'data.updated',
    auditResource: 'ec_reservation',
    meterEventType: 'api_call',
  });
}

export async function commitOnOrder(
  tenantId: string,
  actorId: string,
  cartId: string,
): Promise<{ committed: Reservation[]; onHandAfter: StockLevel[] }> {
  return runCrudOperation({
    configName: 'allocation-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!cartId?.trim()) {
        throw new AppError('cartId required', ErrorCode.BAD_REQUEST);
      }
      expireStale(tenantId);
      const active = [...reservations.values()].filter(
        (r) =>
          r.tenantId === tenantId &&
          r.cartId === cartId &&
          r.status === 'active',
      );
      if (active.length === 0) {
        throw new AppError('No active reservations for cart', ErrorCode.NOT_FOUND);
      }
      const onHandAfter: StockLevel[] = [];
      for (const r of active) {
        const key = stockKey(tenantId, r.sku);
        const level = stock.get(key) || {
          tenantId,
          sku: r.sku,
          onHand: 0,
        };
        level.onHand = Math.max(0, level.onHand - r.quantity);
        stock.set(key, level);
        r.status = 'committed';
        reservations.set(r.id, r);
        onHandAfter.push({ ...level });
      }
      return { committed: active, onHandAfter };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'ec_reservation',
    meterEventType: 'api_call',
  });
}

export async function releaseCart(
  tenantId: string,
  actorId: string,
  cartId: string,
): Promise<{ released: number }> {
  return runCrudOperation({
    configName: 'allocation-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      let released = 0;
      for (const [id, r] of reservations) {
        if (
          r.tenantId === tenantId &&
          r.cartId === cartId &&
          r.status === 'active'
        ) {
          r.status = 'released';
          reservations.set(id, r);
          released += 1;
        }
      }
      return { released };
    },
    auditAction: 'data.updated',
    auditResource: 'ec_reservation',
    meterEventType: 'api_call',
  });
}

export async function getAvailability(
  tenantId: string,
  actorId: string,
  sku: string,
): Promise<{ sku: string; onHand: number; reserved: number; available: number }> {
  return runCrudOperation({
    configName: 'allocation-inventory',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!sku?.trim()) {
        throw new AppError('sku required', ErrorCode.BAD_REQUEST);
      }
      const s = sku.trim();
      const level = stock.get(stockKey(tenantId, s));
      const reserved = activeReserved(tenantId, s);
      const onHand = level?.onHand ?? 0;
      return {
        sku: s,
        onHand,
        reserved,
        available: onHand - reserved,
      };
    },
    auditAction: 'data.read',
    auditResource: 'ec_stock_level',
    meterEventType: 'api_call',
  });
}
