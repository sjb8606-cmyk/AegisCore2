/**
 * platform/no-show-deposit-policy (SAL-03)
 *
 * Deposit hold/capture, late-cancel windows, no-show marking, client strike counts.
 * Payment capture is recorded as intent — wire to @platform/payments in app layer.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('no-show-deposit-policy');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  lateCancelHours: z.number().positive().default(24),
  defaultDepositCents: z.number().int().nonnegative().default(2500),
  strikesBeforeBlock: z.number().int().positive().default(3),
  autoCaptureOnNoShow: z.boolean().default(true),
});

export type DepositStatus =
  | 'none'
  | 'held'
  | 'captured'
  | 'released'
  | 'forfeited';

export type AppointmentOutcome =
  | 'scheduled'
  | 'completed'
  | 'cancelled_on_time'
  | 'cancelled_late'
  | 'no_show';

export interface DepositAppointment {
  id: string;
  tenantId: string;
  clientId: string;
  scheduledAt: string;
  depositCents: number;
  depositStatus: DepositStatus;
  outcome: AppointmentOutcome;
  cancelledAt: string | null;
  createdAt: string;
}

export interface ClientStrikeState {
  tenantId: string;
  clientId: string;
  strikes: number;
  blocked: boolean;
}

const appointments = new Map<string, DepositAppointment>();
const strikes = new Map<string, ClientStrikeState>();

export function __resetNoShowDepositStore(): void {
  appointments.clear();
  strikes.clear();
}

function strikeKey(tenantId: string, clientId: string): string {
  return tenantId + ':' + clientId;
}

function getStrikes(tenantId: string, clientId: string): ClientStrikeState {
  const key = strikeKey(tenantId, clientId);
  let s = strikes.get(key);
  if (!s) {
    s = { tenantId, clientId, strikes: 0, blocked: false };
    strikes.set(key, s);
  }
  return s;
}

export async function createDepositAppointment(
  tenantId: string,
  actorId: string,
  input: {
    clientId: string;
    scheduledAt: string;
    depositCents?: number;
    holdDeposit?: boolean;
  },
): Promise<DepositAppointment> {
  return runCrudOperation({
    configName: 'no-show-deposit-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('no-show-deposit-policy', ConfigSchema);
      if (!input.clientId?.trim()) {
        throw new AppError('clientId required', ErrorCode.BAD_REQUEST);
      }
      const when = Date.parse(input.scheduledAt);
      if (Number.isNaN(when)) {
        throw new AppError('invalid scheduledAt', ErrorCode.BAD_REQUEST);
      }
      const state = getStrikes(tenantId, input.clientId);
      if (state.blocked) {
        throw new AppError(
          'Client blocked due to repeated no-shows',
          ErrorCode.FORBIDDEN,
        );
      }
      const depositCents =
        input.depositCents ?? config.defaultDepositCents;
      if (depositCents < 0) {
        throw new AppError('depositCents must be >= 0', ErrorCode.BAD_REQUEST);
      }
      const appt: DepositAppointment = {
        id: crypto.randomUUID(),
        tenantId,
        clientId: input.clientId,
        scheduledAt: new Date(when).toISOString(),
        depositCents,
        depositStatus:
          input.holdDeposit !== false && depositCents > 0 ? 'held' : 'none',
        outcome: 'scheduled',
        cancelledAt: null,
        createdAt: new Date().toISOString(),
      };
      appointments.set(appt.id, appt);
      return appt;
    },
    auditAction: 'data.created',
    auditResource: 'salon_deposit_appointment',
    meterEventType: 'api_call',
  });
}

export async function cancelAppointment(
  tenantId: string,
  actorId: string,
  appointmentId: string,
  cancelledAt?: string,
): Promise<DepositAppointment> {
  return runCrudOperation({
    configName: 'no-show-deposit-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('no-show-deposit-policy', ConfigSchema);
      const appt = appointments.get(appointmentId);
      if (!appt || appt.tenantId !== tenantId) {
        throw new AppError('Appointment not found', ErrorCode.NOT_FOUND);
      }
      if (appt.outcome !== 'scheduled') {
        throw new AppError('Appointment not cancellable', ErrorCode.CONFLICT);
      }
      const at = cancelledAt ? Date.parse(cancelledAt) : Date.now();
      if (Number.isNaN(at)) {
        throw new AppError('invalid cancelledAt', ErrorCode.BAD_REQUEST);
      }
      const hoursUntil =
        (Date.parse(appt.scheduledAt) - at) / (1000 * 60 * 60);
      const late = hoursUntil < config.lateCancelHours;
      appt.cancelledAt = new Date(at).toISOString();
      if (late) {
        appt.outcome = 'cancelled_late';
        if (appt.depositStatus === 'held' && config.autoCaptureOnNoShow) {
          appt.depositStatus = 'forfeited';
        }
        const state = getStrikes(tenantId, appt.clientId);
        state.strikes += 1;
        if (state.strikes >= config.strikesBeforeBlock) {
          state.blocked = true;
        }
        strikes.set(strikeKey(tenantId, appt.clientId), state);
      } else {
        appt.outcome = 'cancelled_on_time';
        if (appt.depositStatus === 'held') {
          appt.depositStatus = 'released';
        }
      }
      appointments.set(appointmentId, appt);
      logger.info(
        { appointmentId, outcome: appt.outcome, deposit: appt.depositStatus },
        'Appointment cancelled',
      );
      return appt;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'salon_deposit_appointment',
    meterEventType: 'api_call',
  });
}

export async function markNoShow(
  tenantId: string,
  actorId: string,
  appointmentId: string,
): Promise<DepositAppointment> {
  return runCrudOperation({
    configName: 'no-show-deposit-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('no-show-deposit-policy', ConfigSchema);
      const appt = appointments.get(appointmentId);
      if (!appt || appt.tenantId !== tenantId) {
        throw new AppError('Appointment not found', ErrorCode.NOT_FOUND);
      }
      if (appt.outcome !== 'scheduled') {
        throw new AppError('Appointment not in scheduled state', ErrorCode.CONFLICT);
      }
      appt.outcome = 'no_show';
      if (appt.depositStatus === 'held' && config.autoCaptureOnNoShow) {
        appt.depositStatus = 'forfeited';
      }
      const state = getStrikes(tenantId, appt.clientId);
      state.strikes += 1;
      if (state.strikes >= config.strikesBeforeBlock) {
        state.blocked = true;
      }
      strikes.set(strikeKey(tenantId, appt.clientId), state);
      appointments.set(appointmentId, appt);
      return appt;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'salon_deposit_appointment',
    meterEventType: 'api_call',
  });
}

export async function completeAppointment(
  tenantId: string,
  actorId: string,
  appointmentId: string,
): Promise<DepositAppointment> {
  return runCrudOperation({
    configName: 'no-show-deposit-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const appt = appointments.get(appointmentId);
      if (!appt || appt.tenantId !== tenantId) {
        throw new AppError('Appointment not found', ErrorCode.NOT_FOUND);
      }
      if (appt.outcome !== 'scheduled') {
        throw new AppError('Appointment not in scheduled state', ErrorCode.CONFLICT);
      }
      appt.outcome = 'completed';
      if (appt.depositStatus === 'held') {
        appt.depositStatus = 'captured';
      }
      appointments.set(appointmentId, appt);
      return appt;
    },
    auditAction: 'data.updated',
    auditResource: 'salon_deposit_appointment',
    meterEventType: 'api_call',
  });
}

export async function getClientStrikeState(
  tenantId: string,
  actorId: string,
  clientId: string,
): Promise<ClientStrikeState> {
  return runCrudOperation({
    configName: 'no-show-deposit-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getStrikes(tenantId, clientId),
    auditAction: 'data.read',
    auditResource: 'salon_client_strikes',
    meterEventType: 'api_call',
  });
}

export async function clearClientBlock(
  tenantId: string,
  actorId: string,
  clientId: string,
): Promise<ClientStrikeState> {
  return runCrudOperation({
    configName: 'no-show-deposit-policy',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const state = getStrikes(tenantId, clientId);
      state.strikes = 0;
      state.blocked = false;
      strikes.set(strikeKey(tenantId, clientId), state);
      return state;
    },
    auditAction: 'data.updated',
    auditResource: 'salon_client_strikes',
    meterEventType: 'api_call',
  });
}
