/**
 * platform/bot-runtime/src/types.ts
 */

export type FindingSeverity = 'block' | 'crit' | 'warn' | 'info';

export interface Finding {
  cat: 'struct' | 'proc' | 'sem' | 'perf' | 'sec';
  sev: FindingSeverity;
  loc: string;
  desc: string;
  rec: string;
}

export interface PIScore {
  curr: number;
  prev: number;
  delta: number;
}

export interface HarnessConfig {
  max_loops: number;
  target_pi: number;
  converge_thresh: number;
}

export const DEFAULT_HARNESS_CONFIG: HarnessConfig = {
  max_loops: 8,
  target_pi: 99,
  converge_thresh: 2,
};

export type StopReason = 'stop_converged' | 'stop_perfected' | 'stop_budget';

export interface LoopResult<T> {
  loops: number;
  finalPI: PIScore;
  stopReason: StopReason;
  history: Array<{ loop: number; pi: PIScore; result: T }>;
}

export type DecisionStatus = 'logged' | 'pending_approval' | 'approved' | 'rejected';

export interface Decision {
  id: string;
  botId: string;
  status: DecisionStatus;
  input: unknown;
  output: unknown;
  rulesHash: string;
  timestamp: string;
}

export interface SwarmSignal {
  type: string;
  fromBotId: string;
  payload: unknown;
  timestamp: string;
}
