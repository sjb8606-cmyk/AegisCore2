import { getPool } from '@platform/tenancy';
import type { ProviderHealth, ProviderHealthStore } from './types';

export class InMemoryProviderHealthStore implements ProviderHealthStore {
  private readonly states = new Map<string, ProviderHealth>();

  async get(providerId: string): Promise<ProviderHealth | null> {
    return this.states.get(providerId) ?? null;
  }

  async save(state: ProviderHealth): Promise<void> {
    this.states.set(state.providerId, { ...state });
  }

  clear(): void {
    this.states.clear();
  }
}

export class PostgresProviderHealthStore implements ProviderHealthStore {
  async get(providerId: string): Promise<ProviderHealth | null> {
    const rows = await getPool().query(
      `SELECT provider_id, consecutive_failures, consecutive_successes, opened_until, last_failure_at, last_success_at
       FROM integration_provider_health WHERE provider_id = $1`,
      [providerId]
    );
    const row = rows.rows[0];
    if (!row) return null;
    return {
      providerId: row.provider_id,
      consecutiveFailures: Number(row.consecutive_failures),
      consecutiveSuccesses: Number(row.consecutive_successes),
      openedUntil: row.opened_until ? new Date(row.opened_until).getTime() : null,
      lastFailureAt: row.last_failure_at?.toISOString?.() ?? row.last_failure_at ?? null,
      lastSuccessAt: row.last_success_at?.toISOString?.() ?? row.last_success_at ?? null,
    };
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
    const current = await this.store.get(providerId);
    const state: ProviderHealth = current ?? {
      providerId,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      openedUntil: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    };

    state.consecutiveFailures = 0;
    state.consecutiveSuccesses += 1;
    state.lastSuccessAt = new Date().toISOString();

    if (state.consecutiveSuccesses >= this.successThreshold) {
      state.openedUntil = null;
    }

    await this.store.save(state);
  }

  async recordFailure(providerId: string): Promise<void> {
    const current = await this.store.get(providerId);
    const state: ProviderHealth = current ?? {
      providerId,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      openedUntil: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    };

    state.consecutiveFailures += 1;
    state.consecutiveSuccesses = 0;
    state.lastFailureAt = new Date().toISOString();

    if (state.consecutiveFailures >= this.failureThreshold) {
      state.openedUntil = Date.now() + this.openMs;
    }

    await this.store.save(state);
  }

  async health(providerId: string): Promise<ProviderHealth> {
    return (await this.store.get(providerId)) ?? {
      providerId,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      openedUntil: null,
      lastFailureAt: null,
      lastSuccessAt: null,
    };
  }
}
