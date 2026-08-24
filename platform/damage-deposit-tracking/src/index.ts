import * as crypto from 'crypto';
import {
  runCrudOperation,
  AppError,
  ErrorCode
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

const ConfigSchema = {
  safeParse(value: unknown) {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        error: new Error('Invalid configuration')
      };
    }

    return { success: true, data: value };
  }
};

function now(): string {
  return new Date().toISOString();
}

function assertMoney(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new AppError(
      ErrorCode.BAD_REQUEST,
      field + ' must be a non-negative number'
    );
  }
}

export async function holdDeposit(
  tenantId: string,
  actorId: string,
  reservationId: string,
  amount: number,
  conditionAtPickup: string
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'create',
    auditAction: 'data.created',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    actionFn: async () => {
      assertMoney(amount, 'amount');

      if (!reservationId || !conditionAtPickup) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'reservationId and conditionAtPickup are required'
        );
      }

      for (const deposit of store.values()) {
        if (
          deposit.tenant_id === tenantId &&
          deposit.reservation_id === reservationId &&
          deposit.status === 'held'
        ) {
          throw new AppError(
            ErrorCode.CONFLICT,
            'An active deposit already exists for this reservation'
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
        updated_at: timestamp
      };

      store.set(deposit.deposit_id, deposit);
      return deposit;
    }
  });
}

export async function assessReturnCondition(
  tenantId: string,
  actorId: string,
  depositId: string,
  conditionAtReturn: string,
  damageCost: number = 0
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    actionFn: async () => {
      assertMoney(damageCost, 'damageCost');

      const deposit = store.get(depositId);

      if (!deposit || deposit.tenant_id !== tenantId) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Damage deposit not found'
        );
      }

      if (!conditionAtReturn) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'conditionAtReturn is required'
        );
      }

      if (deposit.status !== 'held') {
        throw new AppError(
          ErrorCode.CONFLICT,
          'Only held deposits can be assessed'
        );
      }

      deposit.condition_at_return = conditionAtReturn;
      deposit.damage_assessed = true;
      deposit.damage_cost = Math.min(damageCost, deposit.deposit_amount);
      deposit.updated_at = now();

      return deposit;
    }
  });
}

export async function calculateRefund(
  tenantId: string,
  actorId: string,
  depositId: string
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'update',
    auditAction: 'data.updated',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    actionFn: async () => {
      const deposit = store.get(depositId);

      if (!deposit || deposit.tenant_id !== tenantId) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Damage deposit not found'
        );
      }

      if (!deposit.damage_assessed) {
        throw new AppError(
          ErrorCode.BAD_REQUEST,
          'Return condition must be assessed before calculating refund'
        );
      }

      const refund = Math.max(
        0,
        deposit.deposit_amount - deposit.damage_cost
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
    }
  });
}

export async function getDeposit(
  tenantId: string,
  actorId: string,
  depositId: string
): Promise<DamageDeposit> {
  return runCrudOperation({
    configName: 'damage-deposit-tracking',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: 'read',
    auditAction: 'data.read',
    auditResource: 'damage_deposit',
    meterEventType: 'api_call',
    actionFn: async () => {
      const deposit = store.get(depositId);

      if (!deposit || deposit.tenant_id !== tenantId) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          'Damage deposit not found'
        );
      }

      return deposit;
    }
  });
}

export function __resetDamageDepositStore(): void {
  store.clear();
}
