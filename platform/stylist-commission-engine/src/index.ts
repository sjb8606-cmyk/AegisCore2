/**
 * platform/stylist-commission-engine (SAL-01)
 *
 * Booth rent vs commission splits, service/retail rates, tip handling, period close.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('stylist-commission-engine');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultServiceCommissionBps: z.number().int().min(0).max(10000).default(5000),
  defaultRetailCommissionBps: z.number().int().min(0).max(10000).default(1000),
  tipsInPayout: z.boolean().default(true),
});

export type PayModel = 'commission' | 'booth_rent' | 'hybrid';

export interface StylistPlan {
  id: string;
  tenantId: string;
  stylistId: string;
  payModel: PayModel;
  serviceCommissionBps: number;
  retailCommissionBps: number;
  boothRentCents: number;
  active: boolean;
  createdAt: string;
}

export interface PayPeriod {
  id: string;
  tenantId: string;
  stylistId: string;
  periodStart: string;
  periodEnd: string;
  serviceSalesCents: number;
  retailSalesCents: number;
  tipsCents: number;
  commissionCents: number;
  boothRentCents: number;
  payoutCents: number;
  status: 'open' | 'closed';
  closedAt: string | null;
}

const plans = new Map<string, StylistPlan>();
const periods = new Map<string, PayPeriod>();

export function __resetStylistCommissionStore(): void {
  plans.clear();
  periods.clear();
}

function planKey(tenantId: string, stylistId: string): string {
  return tenantId + ':' + stylistId;
}

export async function upsertStylistPlan(
  tenantId: string,
  actorId: string,
  input: {
    stylistId: string;
    payModel: PayModel;
    serviceCommissionBps?: number;
    retailCommissionBps?: number;
    boothRentCents?: number;
  },
): Promise<StylistPlan> {
  return runCrudOperation({
    configName: 'stylist-commission-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('stylist-commission-engine', ConfigSchema);
      if (!input.stylistId?.trim()) {
        throw new AppError('stylistId required', ErrorCode.BAD_REQUEST);
      }
      if (!['commission', 'booth_rent', 'hybrid'].includes(input.payModel)) {
        throw new AppError('invalid payModel', ErrorCode.BAD_REQUEST);
      }
      const key = planKey(tenantId, input.stylistId);
      const existing = plans.get(key);
      const plan: StylistPlan = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        stylistId: input.stylistId,
        payModel: input.payModel,
        serviceCommissionBps:
          input.serviceCommissionBps ??
          existing?.serviceCommissionBps ??
          config.defaultServiceCommissionBps,
        retailCommissionBps:
          input.retailCommissionBps ??
          existing?.retailCommissionBps ??
          config.defaultRetailCommissionBps,
        boothRentCents: input.boothRentCents ?? existing?.boothRentCents ?? 0,
        active: true,
        createdAt: existing?.createdAt || new Date().toISOString(),
      };
      plans.set(key, plan);
      return plan;
    },
    auditAction: 'data.created',
    auditResource: 'stylist_pay_plan',
    meterEventType: 'api_call',
  });
}

export async function openPayPeriod(
  tenantId: string,
  actorId: string,
  input: { stylistId: string; periodStart: string; periodEnd: string },
): Promise<PayPeriod> {
  return runCrudOperation({
    configName: 'stylist-commission-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const start = Date.parse(input.periodStart);
      const end = Date.parse(input.periodEnd);
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
        throw new AppError('invalid period range', ErrorCode.BAD_REQUEST);
      }
      const plan = plans.get(planKey(tenantId, input.stylistId));
      if (!plan || !plan.active) {
        throw new AppError('No active pay plan for stylist', ErrorCode.NOT_FOUND);
      }
      const period: PayPeriod = {
        id: crypto.randomUUID(),
        tenantId,
        stylistId: input.stylistId,
        periodStart: new Date(start).toISOString(),
        periodEnd: new Date(end).toISOString(),
        serviceSalesCents: 0,
        retailSalesCents: 0,
        tipsCents: 0,
        commissionCents: 0,
        boothRentCents: 0,
        payoutCents: 0,
        status: 'open',
        closedAt: null,
      };
      periods.set(period.id, period);
      return period;
    },
    auditAction: 'data.created',
    auditResource: 'stylist_pay_period',
    meterEventType: 'api_call',
  });
}

export async function postPeriodSales(
  tenantId: string,
  actorId: string,
  periodId: string,
  input: {
    serviceSalesCents?: number;
    retailSalesCents?: number;
    tipsCents?: number;
  },
): Promise<PayPeriod> {
  return runCrudOperation({
    configName: 'stylist-commission-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const period = periods.get(periodId);
      if (!period || period.tenantId !== tenantId) {
        throw new AppError('Period not found', ErrorCode.NOT_FOUND);
      }
      if (period.status !== 'open') {
        throw new AppError('Period is closed', ErrorCode.CONFLICT);
      }
      if (input.serviceSalesCents !== undefined) {
        if (input.serviceSalesCents < 0) {
          throw new AppError('serviceSalesCents must be >= 0', ErrorCode.BAD_REQUEST);
        }
        period.serviceSalesCents += input.serviceSalesCents;
      }
      if (input.retailSalesCents !== undefined) {
        if (input.retailSalesCents < 0) {
          throw new AppError('retailSalesCents must be >= 0', ErrorCode.BAD_REQUEST);
        }
        period.retailSalesCents += input.retailSalesCents;
      }
      if (input.tipsCents !== undefined) {
        if (input.tipsCents < 0) {
          throw new AppError('tipsCents must be >= 0', ErrorCode.BAD_REQUEST);
        }
        period.tipsCents += input.tipsCents;
      }
      periods.set(periodId, period);
      return period;
    },
    auditAction: 'data.updated',
    auditResource: 'stylist_pay_period',
    meterEventType: 'api_call',
  });
}

export async function closePayPeriod(
  tenantId: string,
  actorId: string,
  periodId: string,
): Promise<PayPeriod> {
  return runCrudOperation({
    configName: 'stylist-commission-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('stylist-commission-engine', ConfigSchema);
      const period = periods.get(periodId);
      if (!period || period.tenantId !== tenantId) {
        throw new AppError('Period not found', ErrorCode.NOT_FOUND);
      }
      if (period.status !== 'open') {
        throw new AppError('Period already closed', ErrorCode.CONFLICT);
      }
      const plan = plans.get(planKey(tenantId, period.stylistId));
      if (!plan) {
        throw new AppError('Pay plan missing', ErrorCode.NOT_FOUND);
      }

      let commission = 0;
      if (plan.payModel === 'commission' || plan.payModel === 'hybrid') {
        commission =
          Math.floor((period.serviceSalesCents * plan.serviceCommissionBps) / 10000) +
          Math.floor((period.retailSalesCents * plan.retailCommissionBps) / 10000);
      }
      const rent =
        plan.payModel === 'booth_rent' || plan.payModel === 'hybrid'
          ? plan.boothRentCents
          : 0;
      const tips = config.tipsInPayout ? period.tipsCents : 0;
      const payout = Math.max(0, commission + tips - rent);

      period.commissionCents = commission;
      period.boothRentCents = rent;
      period.payoutCents = payout;
      period.status = 'closed';
      period.closedAt = new Date().toISOString();
      periods.set(periodId, period);
      logger.info(
        { periodId, stylistId: period.stylistId, payout },
        'Pay period closed',
      );
      return period;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'stylist_pay_period',
    meterEventType: 'api_call',
  });
}

export async function getStylistStatement(
  tenantId: string,
  actorId: string,
  periodId: string,
): Promise<PayPeriod> {
  return runCrudOperation({
    configName: 'stylist-commission-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const period = periods.get(periodId);
      if (!period || period.tenantId !== tenantId) {
        throw new AppError('Period not found', ErrorCode.NOT_FOUND);
      }
      return period;
    },
    auditAction: 'data.read',
    auditResource: 'stylist_pay_period',
    meterEventType: 'api_call',
  });
}
