import { getPool } from '@platform/tenancy';
import type { AtomicProviderHealthStore, ProviderHealth, ProviderHealthStore } from './types';

function emptyHealth(providerId: string): ProviderHealth {
  return {
    providerId,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    openedUntil: null,
    lastFailureAt: null,
    lastSuccessAt: null,
  };
}

export class InMemoryProviderHealthStore implements AtomicProviderHealthStore {
  private readonly states = new Map<string, ProviderHealth>();

  async get(providerId: string): Promise<ProviderHealth | null> {
    return this.states.get(providerId) ?? null;
  }

  async save(state: ProviderHealth): Promise<void> {
    this.states.set(state.providerId, { ...state });
  }

  async recordSuccess(providerId: string, successThreshold: number): Promise<ProviderHealth> {
    const state = { ...(this.states.get(providerId) ?? emptyHealth(providerId)) };
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses = Math.min(state.consecutiveSuccesses + 1, successThreshold);
    state.lastSuccessAt = new Date().toISOString();
    if (state.consecutiveSuccesses >= successThreshold) state.openedUntil = null;
    await this.save(state);
    return state;
  }

  async recordFailure(providerId: string, failureThreshold: number, openMs: number): Promise<ProviderHealth> {
    const state = { ...(this.states.get(providerId) ?? emptyHealth(providerId)) };
    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;
    state.lastFailureAt = new Date().toISOString();
    if (state.consecutiveFailures >= failureThreshold) state.openedUntil = Date.now() + openMs;
    await this.save(state);
    return state;
  }

  clear(): void {
    this.states.clear();
  }
}

export class PostgresProviderHealthStore implements AtomicProviderHealthStore {
  async get(providerId: string): Promise<ProviderHealth | null> {
    const rows = await getPool().query(
      `SELECT provider_id, consecutive_failures, consecutive_successes, opened_until, last_failure_at, last_success_at
       FROM integration_provider_health WHERE provider_id = $1`,
      [providerId]
    );
    return rows.rows[0] ? this.mapRow(rows.rows[0]) : null;
  }

  async save(state: ProviderHealth): Promise<void> {
    await getPool().query(
      `INSERT INTO integration_provider_health
        (provider_id, consecutive_failures, consecutive_successes, opened_until, last_failure_at, last_success_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider_id) DO UPDATE SET
        consecutive_failures = EXCLUDED.consecutive_failures,
        consecutive_successes = EXCLUDED.consecutive_successes,
        opened_until = EXCLUDED.opened_until,
        last_failure_at = EXCLUDED.last_failure_at,
        last_success_at = EXCLUDED.last_success_at`,
      [
        state.providerId,
        state.consecutiveFailures,
        state.consecutiveSuccesses,
        state.openedUntil ? new Date(state.openedUntil) : null,
        state.lastFailureAt,
        state.lastSuccessAt,
      ]
    );
  }

  async recordSuccess(providerId: string, successThreshold: number): Promise<ProviderHealth> {
    const rows = await getPool().query(
      `INSERT INTO integration_provider_health
        (provider_id, consecutive_failures, consecutive_successes, opened_until, last_success_at)
       VALUES ($1, 0, 1, NULL, NOW())
       ON CONFLICT (provider_id) DO UPDATE SET
        consecutive_failures = 0,
        consecutive_successes = LEAST(integration_provider_health.consecutive_successes + 1, $2),
        opened_until = CASE WHEN integration_provider_health.consecutive_successes + 1 >= $2 THEN NULL ELSE integration_provider_health.opened_until END,
        last_success_at = NOW()
       RETURNING provider_id, consecutive_failures, consecutive_successes, opened_until, last_failure_at, last_success_at`,
      [providerId, successThreshold]
    );
    return this.mapRow(rows.rows[0]);
  }

  async recordFailure(providerId: string, failureThreshold: number, openMs: number): Promise<ProviderHealth> {
    const rows = await getPool().query(
      `INSERT INTO integration_provider_health
        (provider_id, consecutive_failures, consecutive_successes, opened_until, last_failure_at)
       VALUES ($1, 1, 0, CASE WHEN 1 >= $2 THEN NOW() + ($3 * interval '1 millisecond') ELSE NULL END, NOW())
       ON CONFLICT (provider_id) DO UPDATE SET
        consecutive_failures = integration_provider_health.consecutive_failures + 1,
        consecutive_successes = 0,
        opened_until = CASE WHEN integration_provider_health.consecutive_failures + 1 >= $2 THEN NOW() + ($3 * interval '1 millisecond') ELSE integration_provider_health.opened_until END,
        last_failure_at = NOW()
       RETURNING provider_id, consecutive_failures, consecutive_successes, opened_until, last_failure_at, last_success_at`,
      [providerId, failureThreshold, openMs]
    );
    return this.mapRow(rows.rows[0]);
  }

  private mapRow(row: any): ProviderHealth {
    return {
      providerId: row.provider_id,
      consecutiveFailures: Number(row.consecutive_failures),
      consecutiveSuccesses: Number(row.consecutive_successes),
      openedUntil: row.opened_until ? new Date(row.opened_until).getTime() : null,
      lastFailureAt: row.last_failure_at?.toISOString?.() ?? row.last_failure_at ?? null,
      lastSuccessAt: row.last_success_at?.toISOString?.() ?? row.last_success_at ?? null,
    };
  }
}

export class CircuitBreaker {
  constructor(
    private readonly store: ProviderHealthStore,
    private readonly failureThreshold: number,
    private readonly openMs: number,
    private readonly successThreshold: number,
  ) {}

  async isOpen(providerId: string): Promise<boolean> {
    const state = await this.store.get(providerId);
    return !!state?.openedUntil && state.openedUntil > Date.now();
  }

  async recordSuccess(providerId: string): Promise<void> {
    const atomic = this.store as Partial<AtomicProviderHealthStore>;
    if (typeof atomic.recordSuccess === 'function') {
      await atomic.recordSuccess(providerId, this.successThreshold);
      return;
    }

    const state = { ...(await this.store.get(providerId) ?? emptyHealth(providerId)) };
    state.consecutiveFailures = 0;
    state.consecutiveSuccesses += 1;
    state.lastSuccessAt = new Date().toISOString();
    if (state.consecutiveSuccesses >= this.successThreshold) state.openedUntil = null;
    await this.store.save(state);
  }

  async recordFailure(providerId: string): Promise<void> {
    const atomic = this.store as Partial<AtomicProviderHealthStore>;
    if (typeof atomic.recordFailure === 'function') {
      await atomic.recordFailure(providerId, this.failureThreshold, this.openMs);
      return;
    }

    const state = { ...(await this.store.get(providerId) ?? emptyHealth(providerId)) };
    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;
    state.lastFailureAt = new Date().toISOString();
    if (state.consecutiveFailures >= this.failureThreshold) state.openedUntil = Date.now() + this.openMs;
    await this.store.save(state);
  }

  async health(providerId: string): Promise<ProviderHealth> {
    return (await this.store.get(providerId)) ?? emptyHealth(providerId);
  }
}
