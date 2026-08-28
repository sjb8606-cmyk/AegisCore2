/**
 * platform/folio-posting (HOSP-02)
 *
 * Guest folio: room + incidental charges, payments, balance, optional split.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('folio-posting');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTaxBps: z.number().int().min(0).max(10000).default(0),
  allowNegativeBalance: z.boolean().default(false),
});

export type LineType =
  | 'room'
  | 'fnb'
  | 'minibar'
  | 'laundry'
  | 'other'
  | 'tax'
  | 'payment'
  | 'adjustment';

export interface FolioLine {
  id: string;
  type: LineType;
  description: string;
  amountCents: number;
  postedAt: string;
}

export interface Folio {
  id: string;
  tenantId: string;
  reservationId: string;
  guestName: string;
  status: 'open' | 'closed';
  lines: FolioLine[];
  balanceCents: number;
  createdAt: string;
  closedAt: string | null;
}

const folios = new Map<string, Folio>();

export function __resetFolioPostingStore(): void {
  folios.clear();
}

function getFolioRecord(tenantId: string, folioId: string): Folio {
  const f = folios.get(folioId);
  if (!f || f.tenantId !== tenantId) {
    throw new AppError('Folio not found', ErrorCode.NOT_FOUND);
  }
  return f;
}

function recalc(folio: Folio): void {
  folio.balanceCents = folio.lines.reduce((s, l) => s + l.amountCents, 0);
}

export async function openFolio(
  tenantId: string,
  actorId: string,
  input: { reservationId: string; guestName: string },
): Promise<Folio> {
  return runCrudOperation({
    configName: 'folio-posting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.reservationId?.trim() || !input.guestName?.trim()) {
        throw new AppError(
          'reservationId and guestName required',
          ErrorCode.BAD_REQUEST,
        );
      }
      const existing = [...folios.values()].find(
        (f) =>
          f.tenantId === tenantId &&
          f.reservationId === input.reservationId &&
          f.status === 'open',
      );
      if (existing) {
        throw new AppError('Open folio already exists', ErrorCode.CONFLICT);
      }
      const folio: Folio = {
        id: crypto.randomUUID(),
        tenantId,
        reservationId: input.reservationId,
        guestName: input.guestName.trim(),
        status: 'open',
        lines: [],
        balanceCents: 0,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      folios.set(folio.id, folio);
      return folio;
    },
    auditAction: 'data.created',
    auditResource: 'hosp_folio',
    meterEventType: 'api_call',
  });
}

export async function postCharge(
  tenantId: string,
  actorId: string,
  folioId: string,
  input: {
    type: LineType;
    description: string;
    amountCents: number;
    applyDefaultTax?: boolean;
  },
): Promise<Folio> {
  return runCrudOperation({
    configName: 'folio-posting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('folio-posting', ConfigSchema);
      const folio = getFolioRecord(tenantId, folioId);
      if (folio.status !== 'open') {
        throw new AppError('Folio is closed', ErrorCode.CONFLICT);
      }
      if (!input.description?.trim()) {
        throw new AppError('description required', ErrorCode.BAD_REQUEST);
      }
      if (typeof input.amountCents !== 'number' || input.amountCents === 0) {
        throw new AppError('amountCents must be non-zero', ErrorCode.BAD_REQUEST);
      }
      if (input.type === 'payment') {
        throw new AppError('Use postPayment for payments', ErrorCode.BAD_REQUEST);
      }
      const line: FolioLine = {
        id: crypto.randomUUID(),
        type: input.type,
        description: input.description.trim(),
        amountCents: input.amountCents,
        postedAt: new Date().toISOString(),
      };
      folio.lines.push(line);
      if (
        input.applyDefaultTax &&
        config.defaultTaxBps > 0 &&
        input.amountCents > 0
      ) {
        const tax = Math.floor((input.amountCents * config.defaultTaxBps) / 10000);
        if (tax > 0) {
          folio.lines.push({
            id: crypto.randomUUID(),
            type: 'tax',
            description: 'Tax on ' + line.description,
            amountCents: tax,
            postedAt: new Date().toISOString(),
          });
        }
      }
      recalc(folio);
      folios.set(folioId, folio);
      return folio;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_folio',
    meterEventType: 'api_call',
  });
}

export async function postPayment(
  tenantId: string,
  actorId: string,
  folioId: string,
  amountCents: number,
  description = 'Payment',
): Promise<Folio> {
  return runCrudOperation({
    configName: 'folio-posting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const folio = getFolioRecord(tenantId, folioId);
      if (folio.status !== 'open') {
        throw new AppError('Folio is closed', ErrorCode.CONFLICT);
      }
      if (typeof amountCents !== 'number' || amountCents <= 0) {
        throw new AppError('amountCents must be positive', ErrorCode.BAD_REQUEST);
      }
      folio.lines.push({
        id: crypto.randomUUID(),
        type: 'payment',
        description,
        amountCents: -amountCents,
        postedAt: new Date().toISOString(),
      });
      recalc(folio);
      folios.set(folioId, folio);
      return folio;
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_folio',
    meterEventType: 'api_call',
  });
}

export async function splitFolio(
  tenantId: string,
  actorId: string,
  folioId: string,
  lineIds: string[],
  newGuestName: string,
): Promise<{ original: Folio; split: Folio }> {
  return runCrudOperation({
    configName: 'folio-posting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const folio = getFolioRecord(tenantId, folioId);
      if (folio.status !== 'open') {
        throw new AppError('Folio is closed', ErrorCode.CONFLICT);
      }
      if (!newGuestName?.trim()) {
        throw new AppError('newGuestName required', ErrorCode.BAD_REQUEST);
      }
      const move = folio.lines.filter((l) => lineIds.includes(l.id));
      if (move.length === 0) {
        throw new AppError('No matching lines to split', ErrorCode.BAD_REQUEST);
      }
      folio.lines = folio.lines.filter((l) => !lineIds.includes(l.id));
      recalc(folio);
      folios.set(folioId, folio);

      const split: Folio = {
        id: crypto.randomUUID(),
        tenantId,
        reservationId: folio.reservationId,
        guestName: newGuestName.trim(),
        status: 'open',
        lines: move,
        balanceCents: 0,
        createdAt: new Date().toISOString(),
        closedAt: null,
      };
      recalc(split);
      folios.set(split.id, split);
      return { original: folio, split };
    },
    auditAction: 'data.updated',
    auditResource: 'hosp_folio',
    meterEventType: 'api_call',
  });
}

export async function closeFolio(
  tenantId: string,
  actorId: string,
  folioId: string,
): Promise<Folio> {
  return runCrudOperation({
    configName: 'folio-posting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('folio-posting', ConfigSchema);
      const folio = getFolioRecord(tenantId, folioId);
      if (folio.status !== 'open') {
        throw new AppError('Folio already closed', ErrorCode.CONFLICT);
      }
      recalc(folio);
      if (folio.balanceCents !== 0 && !config.allowNegativeBalance) {
        if (folio.balanceCents > 0) {
          throw new AppError(
            'Cannot close folio with outstanding balance',
            ErrorCode.CONFLICT,
          );
        }
      }
      folio.status = 'closed';
      folio.closedAt = new Date().toISOString();
      folios.set(folioId, folio);
      logger.info({ folioId, balance: folio.balanceCents }, 'Folio closed');
      return folio;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'hosp_folio',
    meterEventType: 'api_call',
  });
}

export async function getFolio(
  tenantId: string,
  actorId: string,
  folioId: string,
): Promise<Folio> {
  return runCrudOperation({
    configName: 'folio-posting',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => getFolioRecord(tenantId, folioId),
    auditAction: 'data.read',
    auditResource: 'hosp_folio',
    meterEventType: 'api_call',
  });
}
