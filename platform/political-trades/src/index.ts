/**
 * platform/political-trades
 *
 * Insider / politician / institution disclosure tracker.
 * MVP: in-memory store + mock ingest + conflict-of-interest flagging.
 * Real parsers (EDGAR Form 4, STOCK Act, 13F) plug in behind ingestDisclosures.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('political-trades');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  sources: z
    .object({
      congress: z.boolean().default(true),
      insiders: z.boolean().default(true),
      institutions: z.boolean().default(false),
    })
    .default({}),
  limits: z
    .object({
      trackedEntities: z.number().int().positive().default(50),
      pollIntervalHours: z.number().int().positive().default(24),
    })
    .default({}),
  tiers: z
    .object({
      entityAlerts: z.boolean().default(true),
      aggregateSignals: z.boolean().default(true),
      crossReferenceCommittees: z.boolean().default(true),
    })
    .default({}),
});

export type PoliticalTradesConfig = z.infer<typeof ConfigSchema>;

export type EntityType = 'politician' | 'insider' | 'fund';
export type TradeAction = 'buy' | 'sell';
export type DisclosureSource = 'congress' | 'form4' | '13f' | 'mock';

export interface TrackedEntity {
  id: string;
  tenantId: string;
  name: string;
  entityType: EntityType;
  /** e.g. { chamber: 'senate', committees: ['Finance'] } */
  roleMetadata: Record<string, unknown>;
  followedAt: string;
}

export interface DisclosedTrade {
  id: string;
  entityId: string;
  entityName: string;
  symbol: string;
  action: TradeAction;
  amountRange: string;
  filedDate: string;
  transactionDate: string;
  source: DisclosureSource;
  conflictFlag: boolean;
  conflictReason: string | null;
  sector: string | null;
}

export interface SymbolSignal {
  symbol: string;
  trades: DisclosedTrade[];
  buyCount: number;
  sellCount: number;
  conflictCount: number;
}

// ── Sector map for conflict checks (tiny MVP sample) ─────────

const SYMBOL_SECTOR: Record<string, string> = {
  XOM: 'energy',
  CVX: 'energy',
  LMT: 'defense',
  RTX: 'defense',
  JPM: 'finance',
  GS: 'finance',
  UNH: 'healthcare',
  PFE: 'healthcare',
  AAPL: 'technology',
  MSFT: 'technology',
};

const COMMITTEE_SECTORS: Record<string, string[]> = {
  Finance: ['finance', 'banking'],
  'Armed Services': ['defense'],
  Energy: ['energy'],
  'Health, Education, Labor, and Pensions': ['healthcare'],
  Commerce: ['technology', 'telecom'],
};

// ── Memory ───────────────────────────────────────────────────

const entities = new Map<string, TrackedEntity>(); // id → entity
const tenantEntities = new Map<string, Set<string>>(); // tenant → entity ids
const trades = new Map<string, DisclosedTrade[]>(); // tenant → trades

export function __resetPoliticalTradesStore(): void {
  entities.clear();
  tenantEntities.clear();
  trades.clear();
}

async function loadCfg(): Promise<PoliticalTradesConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('political-trades', ConfigSchema);
}

/**
 * Flag conflict when trade sector overlaps entity's committee jurisdictions.
 */
export function flagConflictOfInterest(
  trade: { symbol: string; sector?: string | null },
  entity: { roleMetadata: Record<string, unknown> },
): { conflictFlag: boolean; conflictReason: string | null } {
  const sector =
    trade.sector ||
    SYMBOL_SECTOR[trade.symbol.toUpperCase()] ||
    null;
  if (!sector) return { conflictFlag: false, conflictReason: null };

  const committees = (entity.roleMetadata?.committees as string[]) || [];
  for (const c of committees) {
    const sectors = COMMITTEE_SECTORS[c] || [];
    if (sectors.includes(sector)) {
      return {
        conflictFlag: true,
        conflictReason: `Entity sits on ${c}; trade sector is ${sector}`,
      };
    }
  }
  return { conflictFlag: false, conflictReason: null };
}

// ── API ──────────────────────────────────────────────────────

export async function followEntity(
  tenantId: string,
  actorId: string,
  input: {
    name: string;
    entityType: EntityType;
    roleMetadata?: Record<string, unknown>;
  },
): Promise<TrackedEntity> {
  return runCrudOperation({
    configName: 'political-trades',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.name?.trim()) {
        throw new AppError('name is required', ErrorCode.BAD_REQUEST);
      }

      const set = tenantEntities.get(tenantId) || new Set();
      if (set.size >= config.limits.trackedEntities) {
        throw new AppError(
          `Tracked entity limit reached (${config.limits.trackedEntities})`,
          ErrorCode.QUOTA_EXCEEDED,
        );
      }

      const id = crypto.randomUUID();
      const entity: TrackedEntity = {
        id,
        tenantId,
        name: input.name.trim(),
        entityType: input.entityType,
        roleMetadata: input.roleMetadata || {},
        followedAt: new Date().toISOString(),
      };
      entities.set(id, entity);
      set.add(id);
      tenantEntities.set(tenantId, set);
      logger.info({ entityId: id, name: entity.name }, 'Entity followed');
      return entity;
    },
    auditAction: 'data.created',
    auditResource: 'tracked_entity',
    meterEventType: 'api_call',
  });
}

export async function unfollowEntity(
  tenantId: string,
  actorId: string,
  entityId: string,
): Promise<{ unfollowed: boolean }> {
  return runCrudOperation({
    configName: 'political-trades',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const entity = entities.get(entityId);
      if (!entity || entity.tenantId !== tenantId) {
        throw new AppError('Entity not found', ErrorCode.NOT_FOUND);
      }
      entities.delete(entityId);
      tenantEntities.get(tenantId)?.delete(entityId);
      return { unfollowed: true };
    },
    auditAction: 'data.deleted',
    auditResource: 'tracked_entity',
    meterEventType: 'api_call',
  });
}

/**
 * Mock ingest — generates sample disclosures for followed entities.
 * Replace body with real Form 4 / STOCK Act / 13F parsers later.
 */
export async function ingestDisclosures(
  tenantId: string,
  actorId: string,
): Promise<{ inserted: number }> {
  return runCrudOperation({
    configName: 'political-trades',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    actorType: 'service',
    action: async () => {
      const config = await loadCfg();
      const ids = tenantEntities.get(tenantId);
      if (!ids || ids.size === 0) return { inserted: 0 };

      const list = trades.get(tenantId) || [];
      let inserted = 0;
      const sampleSymbols = Object.keys(SYMBOL_SECTOR);

      for (const eid of ids) {
        const entity = entities.get(eid);
        if (!entity) continue;

        // One mock trade per entity per ingest
        const symbol =
          sampleSymbols[Math.abs(entity.name.length) % sampleSymbols.length];
        const action: TradeAction =
          entity.name.length % 2 === 0 ? 'buy' : 'sell';
        const sector = SYMBOL_SECTOR[symbol];
        const conflict = config.tiers.crossReferenceCommittees
          ? flagConflictOfInterest({ symbol, sector }, entity)
          : { conflictFlag: false, conflictReason: null };

        const source: DisclosureSource =
          entity.entityType === 'politician'
            ? 'congress'
            : entity.entityType === 'insider'
              ? 'form4'
              : '13f';

        if (source === 'congress' && !config.sources.congress) continue;
        if (source === 'form4' && !config.sources.insiders) continue;
        if (source === '13f' && !config.sources.institutions) continue;

        const trade: DisclosedTrade = {
          id: crypto.randomUUID(),
          entityId: entity.id,
          entityName: entity.name,
          symbol,
          action,
          amountRange: '$15,001–$50,000',
          filedDate: new Date().toISOString().slice(0, 10),
          transactionDate: new Date(Date.now() - 7 * 86400000)
            .toISOString()
            .slice(0, 10),
          source,
          conflictFlag: conflict.conflictFlag,
          conflictReason: conflict.conflictReason,
          sector,
        };
        list.push(trade);
        inserted++;
      }

      trades.set(tenantId, list);
      logger.info({ tenantId, inserted }, 'Disclosures ingested');
      return { inserted };
    },
    auditAction: 'data.created',
    auditResource: 'disclosed_trade',
    meterEventType: 'api_call',
  });
}

export async function getEntityTrades(
  tenantId: string,
  entityId: string,
): Promise<DisclosedTrade[]> {
  const entity = entities.get(entityId);
  if (!entity || entity.tenantId !== tenantId) {
    throw new AppError('Entity not found', ErrorCode.NOT_FOUND);
  }
  return (trades.get(tenantId) || []).filter((t) => t.entityId === entityId);
}

export async function getSignalsForSymbol(
  tenantId: string,
  symbol: string,
): Promise<SymbolSignal> {
  const sym = symbol.toUpperCase();
  const matched = (trades.get(tenantId) || []).filter((t) => t.symbol === sym);
  return {
    symbol: sym,
    trades: matched,
    buyCount: matched.filter((t) => t.action === 'buy').length,
    sellCount: matched.filter((t) => t.action === 'sell').length,
    conflictCount: matched.filter((t) => t.conflictFlag).length,
  };
}

export async function listFollowedEntities(
  tenantId: string,
): Promise<TrackedEntity[]> {
  const ids = tenantEntities.get(tenantId);
  if (!ids) return [];
  return [...ids].map((id) => entities.get(id)!).filter(Boolean);
}

/**
 * Seed a disclosed trade (tests / manual import).
 */
export function __seedTrade(tenantId: string, trade: DisclosedTrade): void {
  const list = trades.get(tenantId) || [];
  list.push(trade);
  trades.set(tenantId, list);
}
