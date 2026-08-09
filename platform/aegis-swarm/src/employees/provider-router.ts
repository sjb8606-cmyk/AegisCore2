/**
 * platform/aegis-swarm/src/employees/provider-router.ts
 *
 * E-38 — AI Provider Router.
 *
 * Real gap found by checking the actual live ai-gateway code tonight:
 * generateText() there is a dumb dispatch switch — it requires the
 * caller to already know which provider to use, with no fallback if
 * that provider fails or hits a rate limit. Given the person is about
 * to run on Groq's free tier, where rate limits are a near-certainty,
 * this is the real gap worth closing before the key even arrives.
 *
 * Real, distinct logic: classifies which real ai-gateway error codes
 * are retryable (RATE_LIMITED, SERVICE_UNAVAILABLE) versus terminal
 * (BAD_REQUEST, NOT_IMPLEMENTED — retrying those wastes a call for
 * nothing), and selects the next untried provider from a real
 * ordered preference list. Verified against real cases before
 * implementation.
 *
 * This bot does not call any live LLM API itself — it wraps the
 * real ai-gateway's generateText() with retry/fallback logic, so it
 * inherits whatever adapters ai-gateway actually has (Groq today,
 * others once real adapters exist there).
 */

import { CrystalBot } from '@platform/bot-runtime';
import { BotSpecification } from '@platform/bot-registry';

const RETRYABLE_ERROR_CODES = new Set(['RATE_LIMITED', 'SERVICE_UNAVAILABLE']);

export function isRetryable(errorCode: string): boolean {
  return RETRYABLE_ERROR_CODES.has(errorCode);
}

export function selectNextProvider(triedProviders: string[], availableProviders: string[]): string | null {
  return availableProviders.find((p) => !triedProviders.includes(p)) ?? null;
}

export interface ProviderAttempt {
  provider: string;
  succeeded: boolean;
  errorCode?: string;
}

export interface RoutingResult {
  attempts: ProviderAttempt[];
  finalProvider: string | null;
  exhausted: boolean;
}

export interface GenerateTextFn {
  (provider: string): Promise<{ ok: true } | { ok: false; errorCode: string }>;
}

export class ProviderRouterBot extends CrystalBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async routeWithFallback(availableProviders: string[], callProvider: GenerateTextFn): Promise<RoutingResult> {
    await this.enforcePermission('write:ai-generation-request');

    const attempts: ProviderAttempt[] = [];
    const tried: string[] = [];
    let current = selectNextProvider(tried, availableProviders);

    while (current !== null) {
      tried.push(current);
      const result = await callProvider(current);

      if (result.ok) {
        attempts.push({ provider: current, succeeded: true });
        await this.createDecision({ availableProviders }, { finalProvider: current, attemptCount: attempts.length }, 'provider-router-v1');
        return { attempts, finalProvider: current, exhausted: false };
      }

      attempts.push({ provider: current, succeeded: false, errorCode: result.errorCode });

      if (!isRetryable(result.errorCode)) break;

      current = selectNextProvider(tried, availableProviders);
    }

    await this.createDecision({ availableProviders }, { finalProvider: null, attemptCount: attempts.length }, 'provider-router-v1');
    await this.signalSwarm('employee.all_providers_exhausted', { botId: this.botId, attempts });

    return { attempts, finalProvider: null, exhausted: true };
  }
}
