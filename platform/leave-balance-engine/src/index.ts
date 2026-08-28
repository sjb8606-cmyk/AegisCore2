/**
 * platform/leave-balance-engine (HR-01)
 *
 * Leave types, balances, accrual, request/approve, negative-balance policy.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('leave-balance-engine');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  allowNegativeBalance: z.boolean().default(false),
  defaultAnnualAccrualDays: z.number().nonnegative().default(15),
  leaveTypes: z.array(z.string()).default(['pto', 'sick', 'unpaid']),
});

export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface LeaveBalance {
  tenantId: string;
  employeeId: string;
  leaveType: string;
  balanceDays: number;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  tenantId: string;
  employeeId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: LeaveRequestStatus;
  reason: string | null;
  decidedBy: string | null;
  createdAt: string;
}

const balances = new Map<string, LeaveBalance>();
const requests = new Map<string, LeaveRequest>();

export function __resetLeaveBalanceStore(): void {
  balances.clear();
  requests.clear();
}

function balKey(tenantId: string, employeeId: string, leaveType: string): string {
  return tenantId + ':' + employeeId + ':' + leaveType.toLowerCase();
}

function getBalance(
  tenantId: string,
  employeeId: string,
  leaveType: string,
): LeaveBalance {
  const k = balKey(tenantId, employeeId, leaveType);
  let b = balances.get(k);
  if (!b) {
    b = {
      tenantId,
      employeeId,
      leaveType: leaveType.toLowerCase(),
      balanceDays: 0,
      updatedAt: new Date().toISOString(),
    };
    balances.set(k, b);
  }
  return b;
}

function calcDays(startDate: string, endDate: string): number {
  const a = Date.parse(startDate);
  const b = Date.parse(endDate);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) {
    throw new AppError('invalid date range', ErrorCode.BAD_REQUEST);
  }
  return Math.floor((b - a) / 86_400_000) + 1;
}

export async function setBalance(
  tenantId: string,
  actorId: string,
  input: { employeeId: string; leaveType: string; balanceDays: number },
): Promise<LeaveBalance> {
  return runCrudOperation({
    configName: 'leave-balance-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.employeeId?.trim() || !input.leaveType?.trim()) {
        throw new AppError('employeeId and leaveType required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.balanceDays !== 'number') {
        throw new AppError('balanceDays must be a number', ErrorCode.BAD_REQUEST);
      }
      const b = getBalance(tenantId, input.employeeId, input.leaveType);
      b.balanceDays = input.balanceDays;
      b.updatedAt = new Date().toISOString();
      balances.set(balKey(tenantId, input.employeeId, input.leaveType), b);
      return b;
    },
    auditAction: 'data.updated',
    auditResource: 'hr_leave_balance',
    meterEventType: 'api_call',
  });
}

export async function accrueLeave(
  tenantId: string,
  actorId: string,
  input: { employeeId: string; leaveType: string; days: number },
): Promise<LeaveBalance> {
  return runCrudOperation({
    configName: 'leave-balance-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (typeof input.days !== 'number' || input.days <= 0) {
        throw new AppError('days must be positive', ErrorCode.BAD_REQUEST);
      }
      const b = getBalance(tenantId, input.employeeId, input.leaveType);
      b.balanceDays += input.days;
      b.updatedAt = new Date().toISOString();
      balances.set(balKey(tenantId, input.employeeId, input.leaveType), b);
      return b;
    },
    auditAction: 'data.updated',
    auditResource: 'hr_leave_balance',
    meterEventType: 'api_call',
  });
}

export async function requestLeave(
  tenantId: string,
  actorId: string,
  input: {
    employeeId: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    reason?: string;
  },
): Promise<LeaveRequest> {
  return runCrudOperation({
    configName: 'leave-balance-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('leave-balance-engine', ConfigSchema);
      if (!input.employeeId?.trim() || !input.leaveType?.trim()) {
        throw new AppError('employeeId and leaveType required', ErrorCode.BAD_REQUEST);
      }
      const type = input.leaveType.toLowerCase();
      if (
        config.leaveTypes.length > 0 &&
        !config.leaveTypes.map((t) => t.toLowerCase()).includes(type)
      ) {
        throw new AppError('invalid leaveType', ErrorCode.BAD_REQUEST);
      }
      const days = calcDays(input.startDate, input.endDate);
      const b = getBalance(tenantId, input.employeeId, type);
      if (type !== 'unpaid' && b.balanceDays < days && !config.allowNegativeBalance) {
        throw new AppError('Insufficient leave balance', ErrorCode.CONFLICT);
      }
      const req: LeaveRequest = {
        id: crypto.randomUUID(),
        tenantId,
        employeeId: input.employeeId,
        leaveType: type,
        startDate: input.startDate,
        endDate: input.endDate,
        days,
        status: 'pending',
        reason: input.reason?.trim() || null,
        decidedBy: null,
        createdAt: new Date().toISOString(),
      };
      requests.set(req.id, req);
      return req;
    },
    auditAction: 'data.created',
    auditResource: 'hr_leave_request',
    meterEventType: 'api_call',
  });
}

export async function approveLeave(
  tenantId: string,
  actorId: string,
  requestId: string,
): Promise<LeaveRequest> {
  return runCrudOperation({
    configName: 'leave-balance-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('leave-balance-engine', ConfigSchema);
      const req = requests.get(requestId);
      if (!req || req.tenantId !== tenantId) {
        throw new AppError('Request not found', ErrorCode.NOT_FOUND);
      }
      if (req.status !== 'pending') {
        throw new AppError('Request not pending', ErrorCode.CONFLICT);
      }
      if (req.leaveType !== 'unpaid') {
        const b = getBalance(tenantId, req.employeeId, req.leaveType);
        if (b.balanceDays < req.days && !config.allowNegativeBalance) {
          throw new AppError('Insufficient leave balance', ErrorCode.CONFLICT);
        }
        b.balanceDays -= req.days;
        b.updatedAt = new Date().toISOString();
        balances.set(balKey(tenantId, req.employeeId, req.leaveType), b);
      }
      req.status = 'approved';
      req.decidedBy = actorId;
      requests.set(requestId, req);
      logger.info({ requestId, employeeId: req.employeeId }, 'Leave approved');
      return req;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hr_leave_request',
    meterEventType: 'api_call',
  });
}

export async function rejectLeave(
  tenantId: string,
  actorId: string,
  requestId: string,
): Promise<LeaveRequest> {
  return runCrudOperation({
    configName: 'leave-balance-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const req = requests.get(requestId);
      if (!req || req.tenantId !== tenantId) {
        throw new AppError('Request not found', ErrorCode.NOT_FOUND);
      }
      if (req.status !== 'pending') {
        throw new AppError('Request not pending', ErrorCode.CONFLICT);
      }
      req.status = 'rejected';
      req.decidedBy = actorId;
      requests.set(requestId, req);
      return req;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hr_leave_request',
    meterEventType: 'api_call',
  });
}

export async function getBalanceForEmployee(
  tenantId: string,
  actorId: string,
  employeeId: string,
  leaveType: string,
): Promise<LeaveBalance> {
  return runCrudOperation({
    configName: 'leave-balance-engine',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getBalance(tenantId, employeeId, leaveType),
    auditAction: 'data.read',
    auditResource: 'hr_leave_balance',
    meterEventType: 'api_call',
  });
}
