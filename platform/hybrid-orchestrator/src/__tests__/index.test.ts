import { describe, it, expect } from 'vitest';
import {
  shouldActivateFiller,
  checkForHandoff,
  checkFillerTimeout,
  advanceState,
  type DeepJobStatus,
  type OrchestratorConfig,
} from '../index';

const CONFIG: OrchestratorConfig = { fillerThresholdMs: 1500, maxFillerDurationMs: 30000 };

function job(overrides: Partial<DeepJobStatus> = {}): DeepJobStatus {
  return { jobId: 'job-1', submittedAtMs: 0, completedAtMs: null, result: null, ...overrides };
}

describe('shouldActivateFiller', () => {
  it('does not activate before the real threshold elapses', () => {
    expect(shouldActivateFiller(job({ submittedAtMs: 0 }), CONFIG, 500)).toBe(false);
  });

  it('activates once the real threshold has genuinely elapsed', () => {
    expect(shouldActivateFiller(job({ submittedAtMs: 0 }), CONFIG, 2000)).toBe(true);
  });

  it('never activates once the job has genuinely completed, regardless of elapsed time', () => {
    const completed = job({ submittedAtMs: 0, completedAtMs: 100, result: 'done' });
    expect(shouldActivateFiller(completed, CONFIG, 999999)).toBe(false);
  });
});

describe('checkForHandoff', () => {
  it('returns false while the job is genuinely still running', () => {
    expect(checkForHandoff(job())).toBe(false);
  });

  it('returns true only once a real result has genuinely arrived', () => {
    expect(checkForHandoff(job({ completedAtMs: 100, result: 'the real answer' }))).toBe(true);
  });

  it('does not treat a completedAtMs with a null result as a real handoff', () => {
    expect(checkForHandoff(job({ completedAtMs: 100, result: null }))).toBe(false);
  });
});

describe('checkFillerTimeout', () => {
  it('is not timed out before the real ceiling', () => {
    expect(checkFillerTimeout(0, CONFIG, 5000)).toBe(false);
  });

  it('is genuinely timed out once the real ceiling is reached', () => {
    expect(checkFillerTimeout(0, CONFIG, 35000)).toBe(true);
  });
});

describe('advanceState — real state machine composition', () => {
  it('idle -> deep_job_running when a request is submitted', () => {
    expect(advanceState('idle', job(), CONFIG, 0)).toBe('deep_job_running');
  });

  it('deep_job_running -> response_delivered on the real fast path (result arrives before threshold, filler never activates)', () => {
    const fastJob = job({ submittedAtMs: 0, completedAtMs: 400, result: 'fast real answer' });
    expect(advanceState('deep_job_running', fastJob, CONFIG, 500)).toBe('response_delivered');
  });

  it('deep_job_running -> filler_active once the real threshold elapses with no result yet', () => {
    expect(advanceState('deep_job_running', job({ submittedAtMs: 0 }), CONFIG, 2000)).toBe('filler_active');
  });

  it('deep_job_running stays deep_job_running before the threshold, with no result yet', () => {
    expect(advanceState('deep_job_running', job({ submittedAtMs: 0 }), CONFIG, 500)).toBe('deep_job_running');
  });

  it('filler_active -> handoff_pending once the real deep result arrives mid-filler', () => {
    const doneJob = job({ submittedAtMs: 0, completedAtMs: 2000, result: 'the real deep answer' });
    expect(advanceState('filler_active', doneJob, CONFIG, 2500, 1500)).toBe('handoff_pending');
  });

  it('filler_active stays filler_active while genuinely still waiting, under the timeout ceiling', () => {
    expect(advanceState('filler_active', job({ submittedAtMs: 0 }), CONFIG, 5000, 1500)).toBe('filler_active');
  });

  it('filler_active -> response_delivered on a real timeout, even with no result yet (honest fallback, not a fabricated answer)', () => {
    expect(advanceState('filler_active', job({ submittedAtMs: 0 }), CONFIG, 40000, 1500)).toBe('response_delivered');
  });

  it('handoff_pending -> response_delivered once the filler reaches a natural stop', () => {
    expect(advanceState('handoff_pending', job({ completedAtMs: 100, result: 'x' }), CONFIG, 100)).toBe('response_delivered');
  });

  it('response_delivered is genuinely terminal — stays response_delivered', () => {
    expect(advanceState('response_delivered', job({ completedAtMs: 100, result: 'x' }), CONFIG, 999)).toBe('response_delivered');
  });
});
