import * as crypto from 'crypto';
import { z } from 'zod';
import {
  runCrudOperation,
  AppError,
  ErrorCode,
} from '@platform/crud-kernel';

export type DepositStatus =
  | 'held'
  | 'partially_refunded'
  | 'fully_refunded'
  | 'forfeited';

export interface DamageDeposit {
  deposit_id: string;
  reservation_id: string;
  deposit_amount: number;
  condition_at_pickup: string;
  condition_at_return?: string;
  damage_assessed: boolean;
  damage_cost: number;
  refund_amount: number;
  status: DepositStatus;
  tenant_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const store = new Map<string, DamageDeposit>();

export const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  limits: z
    .object({
      max_deposit_amount: z.number().default(100000),
    })
    .default({ max_deposit_amount: 100000 }),
  features: z
    .object({
      damage_assessment: z.boolean().default(true),
      partial_refunds: z.boolean().default(true),
      forfeiture: z.boolean().default(true),
    })
    .default({
      damage_assessment: true,
      partial_refunds: true,
      forfeiture: true,
    }),
});

function now(): string {
  return new Date().toISOString();
}

function assertMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      `${field} must be a non-negative number`,
      ErrorCode.BAD_REQUEST,
    );
  }
}

export async function holdDeposit(
  tenantId: string,
  actorId: string,
  reservationId: string,
  amount: number,
  conditionAtPickup: string,
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.created',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    action: async () => {
      assertMoney(amount, 'amount');

      if (!reservationId || !conditionAtPickup) {
        throw new AppError(
          'reservationId and conditionAtPickup are required',
          ErrorCode.BAD_REQUEST,
        );
      }

      for (const existing of store.values()) {
        if (
          existing.tenant_id === tenantId &&
          existing.reservation_id === reservationId &&
          existing.status === 'held'
        ) {
          throw new AppError(
            'An active deposit already exists for this reservation',
            ErrorCode.CONFLICT,
          );
        }
      }

      const timestamp = now();
      const deposit: DamageDeposit = {
        deposit_id: crypto.randomUUID(),
        reservation_id: reservationId,
        deposit_amount: amount,
        condition_at_pickup: conditionAtPickup,
        damage_assessed: false,
        damage_cost: 0,
        refund_amount: 0,
        status: 'held',
        tenant_id: tenantId,
        created_by: actorId,
        created_at: timestamp,
        updated_at: timestamp,
      };

      store.set(deposit.deposit_id, deposit);
      return deposit;
    },
  });
}

export async function assessReturnCondition(
  tenantId: string,
  actorId: string,
  depositId: string,
  conditionAtReturn: string,
  damageCost: number = 0,
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    action: async () => {
      assertMoney(damageCost, 'damageCost');

      const deposit = store.get(depositId);

      if (!deposit || deposit.tenant_id !== tenantId) {
        throw new AppError(
          'Damage deposit not found',
          ErrorCode.NOT_FOUND,
        );
      }

      if (!conditionAtReturn) {
        throw new AppError(
          'conditionAtReturn is required',
          ErrorCode.BAD_REQUEST,
        );
      }

      if (deposit.status !== 'held') {
        throw new AppError(
          'Only held deposits can be assessed',
          ErrorCode.CONFLICT,
        );
      }

      deposit.condition_at_return = conditionAtReturn;
      deposit.damage_assessed = true;
      deposit.damage_cost = Math.min(damageCost, deposit.deposit_amount);
      deposit.updated_at = now();

      return deposit;
    },
  });
}

export async function calculateRefund(
  tenantId: string,
  actorId: string,
  depositId: string,
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.updated',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    action: async () => {
      const deposit = store.get(depositId);

      if (!deposit || deposit.tenant_id !== tenantId) {
        throw new AppError(
          'Damage deposit not found',
          ErrorCode.NOT_FOUND,
        );
      }

      if (!deposit.damage_assessed) {
        throw new AppError(
          'Return condition must be assessed before calculating refund',
          ErrorCode.BAD_REQUEST,
        );
      }

      const refund = Math.max(
        0,
        deposit.deposit_amount - deposit.damage_cost,
      );

      deposit.refund_amount = refund;
      deposit.status =
        refund === 0
          ? 'forfeited'
          : refund === deposit.deposit_amount
            ? 'fully_refunded'
            : 'partially_refunded';

      deposit.updated_at = now();

      return deposit;
    },
  });
}

export async function getDeposit(
  tenantId: string,
  actorId: string,
  depositId: string,
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    auditAction: 'data.read',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    action: async () => {
      const deposit = store.get(depositId);

      if (!deposit || deposit.tenant_id !== tenantId) {
        throw new AppError(
          'Damage deposit not found',
          ErrorCode.NOT_FOUND,
        );
      }

      return deposit;
    },
  });
}

export function __resetDamageDepositStore(): void {
  store.clear();
}
