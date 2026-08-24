/**
 * platform/eighty-six-board (REST-01)
 *
 * Real-time 86 / low stock board for menu items.
 * assertOrderable blocks or warns when item is 86'd.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('eighty-six-board');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  hardBlockOn86: z.boolean().default(true),
  allowLowWithWarning: z.boolean().default(true),
});

export type ItemBoardStatus = 'available' | 'low' | 'eighty_six';

export interface BoardEntry {
  id: string;
  tenantId: string;
  menuItemId: string;
  status: ItemBoardStatus;
  reason: string | null;
  until: string | null;
  updatedAt: string;
  actorId: string;
}

const board = new Map<string, BoardEntry>();

export function __resetEightySixBoardStore(): void {
  board.clear();
}

function entryKey(tenantId: string, menuItemId: string): string {
  return tenantId + ':' + menuItemId;
}

export async function mark86(
  tenantId: string,
  actorId: string,
  input: {
    menuItemId: string;
    reason?: string;
    until?: string;
  },
): Promise<BoardEntry> {
  return runCrudOperation({
    configName: 'eighty-six-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.menuItemId?.trim()) {
        throw new AppError('menuItemId required', ErrorCode.BAD_REQUEST);
      }
      let untilIso: string | null = null;
      if (input.until) {
        const t = Date.parse(input.until);
        if (Number.isNaN(t)) {
          throw new AppError('invalid until', ErrorCode.BAD_REQUEST);
        }
        untilIso = new Date(t).toISOString();
      }
      const key = entryKey(tenantId, input.menuItemId);
      const existing = board.get(key);
      const entry: BoardEntry = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        menuItemId: input.menuItemId,
        status: 'eighty_six',
        reason: input.reason?.trim() || null,
        until: untilIso,
        updatedAt: new Date().toISOString(),
        actorId,
      };
      board.set(key, entry);
      logger.info({ menuItemId: input.menuItemId }, 'Item 86\'d');
      return entry;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'rest_86_board',
    meterEventType: 'api_call',
  });
}

export async function markLow(
  tenantId: string,
  actorId: string,
  input: { menuItemId: string; reason?: string },
): Promise<BoardEntry> {
  return runCrudOperation({
    configName: 'eighty-six-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!input.menuItemId?.trim()) {
        throw new AppError('menuItemId required', ErrorCode.BAD_REQUEST);
      }
      const key = entryKey(tenantId, input.menuItemId);
      const existing = board.get(key);
      const entry: BoardEntry = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        menuItemId: input.menuItemId,
        status: 'low',
        reason: input.reason?.trim() || null,
        until: null,
        updatedAt: new Date().toISOString(),
        actorId,
      };
      board.set(key, entry);
      return entry;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_86_board',
    meterEventType: 'api_call',
  });
}

export async function clear86(
  tenantId: string,
  actorId: string,
  menuItemId: string,
): Promise<BoardEntry> {
  return runCrudOperation({
    configName: 'eighty-six-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      if (!menuItemId?.trim()) {
        throw new AppError('menuItemId required', ErrorCode.BAD_REQUEST);
      }
      const key = entryKey(tenantId, menuItemId);
      const existing = board.get(key);
      const entry: BoardEntry = {
        id: existing?.id || crypto.randomUUID(),
        tenantId,
        menuItemId,
        status: 'available',
        reason: null,
        until: null,
        updatedAt: new Date().toISOString(),
        actorId,
      };
      board.set(key, entry);
      return entry;
    },
    auditAction: 'data.updated',
    auditResource: 'rest_86_board',
    meterEventType: 'api_call',
  });
}

function effectiveStatus(entry: BoardEntry | undefined): ItemBoardStatus {
  if (!entry) return 'available';
  if (entry.status === 'eighty_six' && entry.until) {
    if (Date.parse(entry.until) < Date.now()) return 'available';
  }
  return entry.status;
}

export async function assertOrderable(
  tenantId: string,
  menuItemId: string,
): Promise<{ orderable: boolean; status: ItemBoardStatus; warning: string | null }> {
  const { loadConfig } = await import('@platform/utils');
  const config = loadConfig('eighty-six-board', ConfigSchema);
  const entry = board.get(entryKey(tenantId, menuItemId));
  const status = effectiveStatus(entry);

  if (status === 'eighty_six') {
    if (config.hardBlockOn86) {
      throw new AppError(
        'Item is 86\'d' + (entry?.reason ? ': ' + entry.reason : ''),
        ErrorCode.FORBIDDEN,
      );
    }
    return {
      orderable: false,
      status,
      warning: entry?.reason || 'Item 86\'d',
    };
  }
  if (status === 'low' && config.allowLowWithWarning) {
    return {
      orderable: true,
      status,
      warning: entry?.reason || 'Low stock',
    };
  }
  return { orderable: true, status, warning: null };
}

export async function getBoard(
  tenantId: string,
  actorId: string,
): Promise<BoardEntry[]> {
  return runCrudOperation({
    configName: 'eighty-six-board',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      return [...board.values()]
        .filter((e) => e.tenantId === tenantId)
        .map((e) => {
          const status = effectiveStatus(e);
          return status === e.status ? e : { ...e, status };
        })
        .filter((e) => e.status !== 'available')
        .sort((a, b) => a.menuItemId.localeCompare(b.menuItemId));
    },
    auditAction: 'data.read',
    auditResource: 'rest_86_board',
    meterEventType: 'api_call',
  });
}
