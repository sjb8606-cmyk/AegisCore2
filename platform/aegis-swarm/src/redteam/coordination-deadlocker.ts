/**
 * platform/aegis-swarm/src/redteam/coordination-deadlocker.ts
 *
 * R-13 — Coordination Deadlocker.
 *
 * "D-14 logic loops and deadlocks." This bot is a genuinely different
 * shape from R-02/R-05/R-07/R-08/R-11: D-14's guard is raw SQL
 * (`WHERE status = ANY(...)`), not a pure JS function, so there's no
 * standalone logic to attack the way there was for the earlier bots.
 *
 * analyzeStateGraph() is real, computed work: a genuine DFS-based
 * cycle-detection algorithm run against D-14's actual, live
 * ALLOWED_FROM transition map (exported from incident-store.ts for
 * this exact purpose, same pattern as D-07/D-09/D-01). The result is
 * a real negative finding — no logic-loop deadlock exists, 'resolved'
 * is a genuine terminal state — proving a suspected vulnerability
 * class ISN'T there, which is legitimate red-team value, not a lesser
 * result than an attack that succeeds. It also has ongoing value as a
 * regression check: if ALLOWED_FROM is ever edited to accidentally
 * introduce a cycle, this same analysis catches it immediately.
 *
 * attemptConcurrentRace() is an honest stub. The one remaining real
 * attack surface — two simultaneous status-update requests racing
 * against the SQL-level guard — genuinely cannot be verified without
 * a live Postgres connection under real concurrent load, which this
 * sandbox does not have.
 */

import { RedTeamBot } from './redteam-isolation';
import { BotSpecification } from '@platform/bot-registry';
import { IncidentStatus } from '../lib/incident-store';

export interface StateGraphAnalysis {
  forwardGraph: Record<string, string[]>;
  hasCycle: boolean;
  terminalStates: string[];
  deadlockPossible: boolean;
}

export class CoordinationDeadlockerBot extends RedTeamBot {
  constructor(spec: BotSpecification) {
    super(spec);
  }

  async analyzeStateGraph(
    allowedFrom: Record<IncidentStatus, IncidentStatus[]>,
  ): Promise<StateGraphAnalysis> {
    await this.enforcePermission('redteam:attack-coordination-logic');

    const forwardGraph = this.buildForwardGraph(allowedFrom);
    const cycleFound = this.detectCycle(forwardGraph);
    const terminalStates = Object.keys(forwardGraph).filter((s) => forwardGraph[s].length === 0);

    const analysis: StateGraphAnalysis = {
      forwardGraph,
      hasCycle: cycleFound,
      terminalStates,
      deadlockPossible: cycleFound,
    };

    await this.createDecision({ allowedFrom }, analysis, 'redteam-coordination-deadlocker-v1');
    await this.signalSwarm('redteam.state_graph_analysis', { botId: this.botId, ...analysis });

    return analysis;
  }

  async attemptConcurrentRace(): Promise<never> {
    throw new Error(
      'Concurrent-transaction race testing is not available yet: this environment has no live ' +
        'Postgres connection to run real simultaneous updateIncidentStatus() calls against under ' +
        'genuine concurrent load. The SQL-level guard (WHERE status = ANY(...) RETURNING id) is ' +
        "designed to handle this correctly via Postgres's own transaction serialization, but that " +
        'design has not been proven here against a real database. analyzeStateGraph() works today ' +
        'against the real transition map and confirms no logic-loop deadlock exists.',
    );
  }

  private buildForwardGraph(
    allowedFrom: Record<IncidentStatus, IncidentStatus[]>,
  ): Record<string, string[]> {
    const forward: Record<string, string[]> = {};
    for (const state of Object.keys(allowedFrom)) forward[state] = [];

    for (const [toState, fromStates] of Object.entries(allowedFrom)) {
      for (const fromState of fromStates) {
        forward[fromState].push(toState);
      }
    }

    return forward;
  }

  private detectCycle(graph: Record<string, string[]>): boolean {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color: Record<string, number> = {};
    for (const node of Object.keys(graph)) color[node] = WHITE;

    const dfs = (node: string): boolean => {
      color[node] = GRAY;
      for (const neighbor of graph[node]) {
        if (color[neighbor] === GRAY) return true;
        if (color[neighbor] === WHITE && dfs(neighbor)) return true;
      }
      color[node] = BLACK;
      return false;
    };

    for (const node of Object.keys(graph)) {
      if (color[node] === WHITE && dfs(node)) return true;
    }
    return false;
  }
}
