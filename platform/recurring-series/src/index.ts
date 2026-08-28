/**
 * platform/recurring-series (SCH-03)
 *
 * Simple recurring appointment series: weekly/biweekly/monthly.
 * Materialize occurrences, exception dates, cancel occurrence/series.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('recurring-series');

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  maxOccurrences: z.number().int().positive().default(52),
});

export type SeriesFrequency = 'weekly' | 'biweekly' | 'monthly';
export type OccurrenceStatus = 'scheduled' | 'cancelled' | 'exception';

export interface RecurringSeries {
  id: string;
  tenantId: string;
  resourceId: string | null;
  title: string;
  frequency: SeriesFrequency;
  startAt: string;
  durationMinutes: number;
  count: number;
  exceptionDates: string[];
  status: 'active' | 'cancelled';
  createdAt: string;
}

export interface SeriesOccurrence {
  id: string;
  tenantId: string;
  seriesId: string;
  startAt: string;
  endAt: string;
  status: OccurrenceStatus;
}

const seriesMap = new Map<string, RecurringSeries>();
const occurrences = new Map<string, SeriesOccurrence>();

export function __resetRecurringSeriesStore(): void {
  seriesMap.clear();
  occurrences.clear();
}

function addInterval(date: Date, frequency: SeriesFrequency): Date {
  const d = new Date(date.getTime());
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  else {
    // monthly — same day of month, clamp if needed
    const day = d.getUTCDate();
    d.setUTCMonth(d.getUTCMonth() + 1);
    if (d.getUTCDate() < day) d.setUTCDate(0); // last day of prev month
  }
  return d;
}

function materialize(series: RecurringSeries): SeriesOccurrence[] {
  const out: SeriesOccurrence[] = [];
  let cursor = new Date(Date.parse(series.startAt));
  for (let i = 0; i < series.count; i++) {
    const startIso = cursor.toISOString();
    const dateKey = startIso.slice(0, 10);
    const isException = series.exceptionDates.includes(dateKey);
    const endIso = new Date(
      cursor.getTime() + series.durationMinutes * 60_000,
    ).toISOString();
    out.push({
      id: crypto.randomUUID(),
      tenantId: series.tenantId,
      seriesId: series.id,
      startAt: startIso,
      endAt: endIso,
      status: isException ? 'exception' : 'scheduled',
    });
    cursor = addInterval(cursor, series.frequency);
  }
  return out;
}

export async function createSeries(
  tenantId: string,
  actorId: string,
  input: {
    title: string;
    frequency: SeriesFrequency;
    startAt: string;
    durationMinutes: number;
    count: number;
    resourceId?: string;
  },
): Promise<{ series: RecurringSeries; occurrences: SeriesOccurrence[] }> {
  return runCrudOperation({
    configName: 'recurring-series',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const { loadConfig } = await import('@platform/utils');
      const config = loadConfig('recurring-series', ConfigSchema);
      if (!input.title?.trim()) {
        throw new AppError('title required', ErrorCode.BAD_REQUEST);
      }
      if (!['weekly', 'biweekly', 'monthly'].includes(input.frequency)) {
        throw new AppError('invalid frequency', ErrorCode.BAD_REQUEST);
      }
      if (Number.isNaN(Date.parse(input.startAt))) {
        throw new AppError('invalid startAt', ErrorCode.BAD_REQUEST);
      }
      if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
        throw new AppError('durationMinutes must be positive', ErrorCode.BAD_REQUEST);
      }
      if (
        !Number.isInteger(input.count) ||
        input.count <= 0 ||
        input.count > config.maxOccurrences
      ) {
        throw new AppError(
          'count must be 1..' + config.maxOccurrences,
          ErrorCode.BAD_REQUEST,
        );
      }
      const series: RecurringSeries = {
        id: crypto.randomUUID(),
        tenantId,
        resourceId: input.resourceId || null,
        title: input.title.trim(),
        frequency: input.frequency,
        startAt: new Date(Date.parse(input.startAt)).toISOString(),
        durationMinutes: input.durationMinutes,
        count: input.count,
        exceptionDates: [],
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      seriesMap.set(series.id, series);
      const occs = materialize(series);
      for (const o of occs) occurrences.set(o.id, o);
      return { series, occurrences: occs };
    },
    auditAction: 'data.created',
    auditResource: 'sch_recurring_series',
    meterEventType: 'api_call',
  });
}

export async function cancelOccurrence(
  tenantId: string,
  actorId: string,
  occurrenceId: string,
): Promise<SeriesOccurrence> {
  return runCrudOperation({
    configName: 'recurring-series',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const occ = occurrences.get(occurrenceId);
      if (!occ || occ.tenantId !== tenantId) {
        throw new AppError('Occurrence not found', ErrorCode.NOT_FOUND);
      }
      if (occ.status === 'cancelled') {
        throw new AppError('Already cancelled', ErrorCode.CONFLICT);
      }
      occ.status = 'cancelled';
      occurrences.set(occurrenceId, occ);
      const series = seriesMap.get(occ.seriesId);
      if (series) {
        const dateKey = occ.startAt.slice(0, 10);
        if (!series.exceptionDates.includes(dateKey)) {
          series.exceptionDates.push(dateKey);
          seriesMap.set(series.id, series);
        }
      }
      return occ;
    },
    auditAction: 'data.updated',
    auditResource: 'sch_series_occurrence',
    meterEventType: 'api_call',
  });
}

export async function cancelSeries(
  tenantId: string,
  actorId: string,
  seriesId: string,
): Promise<RecurringSeries> {
  return runCrudOperation({
    configName: 'recurring-series',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const series = seriesMap.get(seriesId);
      if (!series || series.tenantId !== tenantId) {
        throw new AppError('Series not found', ErrorCode.NOT_FOUND);
      }
      series.status = 'cancelled';
      seriesMap.set(seriesId, series);
      for (const [id, occ] of occurrences) {
        if (
          occ.tenantId === tenantId &&
          occ.seriesId === seriesId &&
          occ.status === 'scheduled'
        ) {
          occ.status = 'cancelled';
          occurrences.set(id, occ);
        }
      }
      logger.info({ seriesId }, 'Series cancelled');
      return series;
    },
    auditAction: 'bot.decision_recorded',
    auditResource: 'sch_recurring_series',
    meterEventType: 'api_call',
  });
}

export async function listOccurrences(
  tenantId: string,
  actorId: string,
  seriesId: string,
): Promise<SeriesOccurrence[]> {
  return runCrudOperation({
    configName: 'recurring-series',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () =>
      [...occurrences.values()]
        .filter((o) => o.tenantId === tenantId && o.seriesId === seriesId)
        .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    auditAction: 'data.read',
    auditResource: 'sch_series_occurrence',
    meterEventType: 'api_call',
  });
}
