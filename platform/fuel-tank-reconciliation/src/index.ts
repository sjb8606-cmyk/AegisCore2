/**
 * platform/fuel-tank-reconciliation (MAR-05)
 *
 * Fuel deliveries + pump sales + stick readings → variance report.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('fuel-tank-reconciliation');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  varianceAlertLiters: z.number().nonnegative().default(50),
  fuelGrades: z.array(z.string()).default(['gas', 'diesel']),
});

export type FuelGrade = string;

export interface FuelTank {
  id: string;
  tenantId: string;
  label: string;
  grade: FuelGrade;
  capacityLiters: number;
  bookLiters: number;
}

export interface FuelDelivery {
  id: string;
  tenantId: string;
  tankId: string;
  liters: number;
  deliveredAt: string;
  supplierRef: string | null;
}

export interface FuelSale {
  id: string;
  tenantId: string;
  tankId: string;
  liters: number;
  soldAt: string;
  pumpId: string | null;
}

export interface StickReading {
  id: string;
  tenantId: string;
  tankId: string;
  liters: number;
  readAt: string;
  actorId: string;
}

export interface ReconcileResult {
  tankId: string;
  bookLiters: number;
  stickLiters: number;
  varianceLiters: number;
  alert: boolean;
}

const tanks = new Map<string, FuelTank>();
const deliveries = new Map<string, FuelDelivery>();
const sales = new Map<string, FuelSale>();
const sticks = new Map<string, StickReading>();

export function __resetFuelTankStore(): void {
  tanks.clear();
  deliveries.clear();
  sales.clear();
  sticks.clear();
}

function getTank(tenantId: string, tankId: string): FuelTank {
  const t = tanks.get(tankId);
  if (!t || t.tenantId !== tenantId) {
    throw new AppError('Tank not found', ErrorCode.NOT_FOUND);
  }
  return t;
}

export async function createTank(
  tenantId: string,
  actorId: string,
  input: {
    label: string;
    grade: string;
    capacityLiters: number;
    openingLiters?: number;
  },
): Promise<FuelTank> {
  return runCrudOperation({
    configName: 'fuel-tank-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.label?.trim() || !input.grade?.trim()) {
        throw new AppError('label and grade required', ErrorCode.BAD_REQUEST);
      }
      if (input.capacityLiters <= 0) {
        throw new AppError('capacityLiters must be positive', ErrorCode.BAD_REQUEST);
      }
      const opening = input.openingLiters ?? 0;
      if (opening < 0 || opening > input.capacityLiters) {
        throw new AppError('invalid openingLiters', ErrorCode.BAD_REQUEST);
      }
      const tank: FuelTank = {
        id: crypto.randomUUID(),
        tenantId,
        label: input.label.trim(),
        grade: input.grade.trim().toLowerCase(),
        capacityLiters: input.capacityLiters,
        bookLiters: opening,
      };
      tanks.set(tank.id, tank);
      return tank;
    },
    auditAction: 'data.created',
    auditResource: 'marina_fuel_tank',
    meterEventType: 'api_call',
  });
}

export async function recordDelivery(
  tenantId: string,
  actorId: string,
  input: {
    tankId: string;
    liters: number;
    supplierRef?: string;
    deliveredAt?: string;
  },
): Promise<FuelDelivery> {
  return runCrudOperation({
    configName: 'fuel-tank-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (typeof input.liters !== 'number' || input.liters <= 0) {
        throw new AppError('liters must be positive', ErrorCode.BAD_REQUEST);
      }
      const tank = getTank(tenantId, input.tankId);
      if (tank.bookLiters + input.liters > tank.capacityLiters) {
        throw new AppError('Delivery exceeds tank capacity', ErrorCode.CONFLICT);
      }
      tank.bookLiters += input.liters;
      tanks.set(tank.id, tank);
      const row: FuelDelivery = {
        id: crypto.randomUUID(),
        tenantId,
        tankId: tank.id,
        liters: input.liters,
        deliveredAt: input.deliveredAt
          ? new Date(Date.parse(input.deliveredAt)).toISOString()
          : new Date().toISOString(),
        supplierRef: input.supplierRef?.trim() || null,
      };
      deliveries.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'marina_fuel_delivery',
    meterEventType: 'api_call',
  });
}

export async function recordPumpSale(
  tenantId: string,
  actorId: string,
  input: {
    tankId: string;
    liters: number;
    pumpId?: string;
    soldAt?: string;
  },
): Promise<FuelSale> {
  return runCrudOperation({
    configName: 'fuel-tank-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (typeof input.liters !== 'number' || input.liters <= 0) {
        throw new AppError('liters must be positive', ErrorCode.BAD_REQUEST);
      }
      const tank = getTank(tenantId, input.tankId);
      if (input.liters > tank.bookLiters) {
        throw new AppError('Sale exceeds book inventory', ErrorCode.CONFLICT);
      }
      tank.bookLiters -= input.liters;
      tanks.set(tank.id, tank);
      const row: FuelSale = {
        id: crypto.randomUUID(),
        tenantId,
        tankId: tank.id,
        liters: input.liters,
        soldAt: input.soldAt
          ? new Date(Date.parse(input.soldAt)).toISOString()
          : new Date().toISOString(),
        pumpId: input.pumpId || null,
      };
      sales.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'marina_fuel_sale',
    meterEventType: 'api_call',
  });
}

export async function recordStickReading(
  tenantId: string,
  actorId: string,
  input: { tankId: string; liters: number; readAt?: string },
): Promise<StickReading> {
  return runCrudOperation({
    configName: 'fuel-tank-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const tank = getTank(tenantId, input.tankId);
      if (typeof input.liters !== 'number' || input.liters < 0) {
        throw new AppError('liters must be >= 0', ErrorCode.BAD_REQUEST);
      }
      if (input.liters > tank.capacityLiters) {
        throw new AppError('Stick exceeds capacity', ErrorCode.BAD_REQUEST);
      }
      const row: StickReading = {
        id: crypto.randomUUID(),
        tenantId,
        tankId: tank.id,
        liters: input.liters,
        readAt: input.readAt
          ? new Date(Date.parse(input.readAt)).toISOString()
          : new Date().toISOString(),
        actorId,
      };
      sticks.set(row.id, row);
      return row;
    },
    auditAction: 'data.created',
    auditResource: 'marina_fuel_stick',
    meterEventType: 'api_call',
  });
}

export async function reconcileTank(
  tenantId: string,
  actorId: string,
  tankId: string,
  stickLiters?: number,
): Promise<ReconcileResult> {
  return runCrudOperation({
    configName: 'fuel-tank-reconciliation',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('fuel-tank-reconciliation', ConfigSchema);
      const tank = getTank(tenantId, tankId);
      let stick = stickLiters;
      if (stick === undefined) {
        const latest = [...sticks.values()]
          .filter((s) => s.tenantId === tenantId && s.tankId === tankId)
          .sort((a, b) => Date.parse(b.readAt) - Date.parse(a.readAt))[0];
        if (!latest) {
          throw new AppError('No stick reading available', ErrorCode.NOT_FOUND);
        }
        stick = latest.liters;
      }
      const varianceLiters = stick - tank.bookLiters;
      const alert = Math.abs(varianceLiters) >= config.varianceAlertLiters;
      if (alert) {
        logger.warn(
          { tankId, book: tank.bookLiters, stick, varianceLiters },
          'Fuel variance alert',
        );
      }
      return {
        tankId,
        bookLiters: tank.bookLiters,
        stickLiters: stick,
        varianceLiters,
        alert,
      };
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'marina_fuel_reconcile',
    meterEventType: 'api_call',
  });
}
