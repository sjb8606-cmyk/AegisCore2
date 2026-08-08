/**
 * platform/hybrid-orchestrator/src/index.ts
 */

export type OrchestratorState =
  | 'idle'
  | 'deep_job_running'
  | 'filler_active'
  | 'handoff_pending'
  | 'response_delivered';

export interface DeepJobStatus {
  jobId: string;
  submittedAtMs: number;
  completedAtMs: number | null;
  result: string | null;
}

export interface OrchestratorConfig {
  fillerThresholdMs: number;
  maxFillerDurationMs: number;
}

export function shouldActivateFiller(
  job: DeepJobStatus,
  config: OrchestratorConfig,
  nowMs: number
): boolean {
  if (job.completedAtMs !== null) return false;
  return nowMs - job.submittedAtMs >= config.fillerThresholdMs;
}

export function checkForHandoff(job: DeepJobStatus): boolean {
  return job.completedAtMs !== null && job.result !== null;
}

export function checkFillerTimeout(
  fillerStartedAtMs: number,
  config: OrchestratorConfig,
  nowMs: number
): boolean {
  return nowMs - fillerStartedAtMs >= config.maxFillerDurationMs;
}

export function advanceState(
  currentState: OrchestratorState,
  job: DeepJobStatus,
  config: OrchestratorConfig,
  nowMs: number,
  fillerStartedAtMs: number | null = null
): OrchestratorState {
  switch (currentState) {
    case 'idle':
      return 'deep_job_running';

    case 'deep_job_running': {
      if (checkForHandoff(job)) return 'response_delivered';
      if (shouldActivateFiller(job, config, nowMs)) return 'filler_active';
      return 'deep_job_running';
    }

    case 'filler_active': {
      if (fillerStartedAtMs !== null && checkFillerTimeout(fillerStartedAtMs, config, nowMs)) {
        return 'response_delivered';
      }
      if (checkForHandoff(job)) return 'handoff_pending';
      return 'filler_active';
    }

    case 'handoff_pending':
      return 'response_delivered';

    case 'response_delivered':
      return 'response_delivered';

    default:
      return currentState;
  }
}
