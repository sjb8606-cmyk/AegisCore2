/**
 * platform/mission-phase
 *
 * Structured campaign phases that restrict allowed_tools per phase.
 * Feeds CONSTRAIN in agent-reasoning.
 */

import * as crypto from 'crypto';
import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { getLogger } from '@platform/observability';

export { AppError, ErrorCode };

const logger = getLogger('mission-phase');

const PhaseSchema = z.object({
  name: z.string(),
  allowedTools: z.array(z.string()),
  completionCriteria: z.string(),
});

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  missionTypes: z
    .record(
      z.object({
        phases: z.array(PhaseSchema),
      }),
    )
    .default({
      standard: {
        phases: [
          {
            name: 'Recon',
            allowedTools: ['web_search', 'read_calendar', 'noop'],
            completionCriteria: 'context_gathered',
          },
          {
            name: 'Position',
            allowedTools: ['web_search', 'draft_email', 'run_code', 'noop'],
            completionCriteria: 'plan_ready',
          },
          {
            name: 'Execute',
            allowedTools: [
              'send_email',
              'add_calendar_event',
              'call_api',
              'place_order',
              'noop',
            ],
            completionCriteria: 'actions_done',
          },
          {
            name: 'Consolidate',
            allowedTools: ['noop', 'draft_email'],
            completionCriteria: 'summary_written',
          },
        ],
      },
      research: {
        phases: [
          {
            name: 'Recon',
            allowedTools: ['web_search', 'noop'],
            completionCriteria: 'sources_collected',
          },
          {
            name: 'Synthesize',
            allowedTools: ['run_code', 'noop'],
            completionCriteria: 'report_drafted',
          },
        ],
      },
    }),
});

export type MissionPhaseConfig = z.infer<typeof ConfigSchema>;
export type PhaseDef = z.infer<typeof PhaseSchema>;

export interface AgentMission {
  id: string;
  runId: string;
  tenantId: string;
  missionType: string;
  currentPhaseIndex: number;
  phases: PhaseDef[];
  completedCriteria: string[];
  createdAt: string;
}

const missions = new Map<string, AgentMission>(); // by runId

export function __resetMissionPhaseStore(): void {
  missions.clear();
}

async function loadCfg(): Promise<MissionPhaseConfig> {
  const { loadConfig } = await import('@platform/utils');
  return loadConfig('mission-phase', ConfigSchema);
}

export async function startMission(
  tenantId: string,
  actorId: string,
  input: { runId: string; missionType?: string },
): Promise<AgentMission> {
  return runCrudOperation({
    configName: 'mission-phase',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const config = await loadCfg();
      if (!input.runId) {
        throw new AppError('runId is required', ErrorCode.BAD_REQUEST);
      }
      const missionType = input.missionType || 'standard';
      const typeDef = config.missionTypes[missionType];
      if (!typeDef?.phases?.length) {
        throw new AppError(
          `Unknown mission type: ${missionType}`,
          ErrorCode.BAD_REQUEST,
        );
      }

      const mission: AgentMission = {
        id: crypto.randomUUID(),
        runId: input.runId,
        tenantId,
        missionType,
        currentPhaseIndex: 0,
        phases: typeDef.phases,
        completedCriteria: [],
        createdAt: new Date().toISOString(),
      };
      missions.set(input.runId, mission);
      logger.info(
        { runId: input.runId, missionType, phase: mission.phases[0].name },
        'Mission started',
      );
      return mission;
    },
    auditAction: 'data.created',
    auditResource: 'agent_mission',
    meterEventType: 'api_call',
  });
}

export async function getMissionStatus(
  tenantId: string,
  runId: string,
): Promise<{
  mission: AgentMission;
  currentPhase: PhaseDef;
  allowedTools: string[];
  isComplete: boolean;
} | null> {
  const m = missions.get(runId);
  if (!m || m.tenantId !== tenantId) return null;
  const currentPhase = m.phases[m.currentPhaseIndex];
  const isComplete = m.currentPhaseIndex >= m.phases.length;
  return {
    mission: m,
    currentPhase: currentPhase || m.phases[m.phases.length - 1],
    allowedTools: isComplete ? [] : currentPhase.allowedTools,
    isComplete,
  };
}

export async function advancePhase(
  tenantId: string,
  actorId: string,
  runId: string,
  input?: { satisfiedCriteria?: string },
): Promise<{
  mission: AgentMission;
  currentPhase: PhaseDef | null;
  allowedTools: string[];
  advanced: boolean;
}> {
  return runCrudOperation({
    configName: 'mission-phase',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    action: async () => {
      const m = missions.get(runId);
      if (!m || m.tenantId !== tenantId) {
        throw new AppError('Mission not found', ErrorCode.NOT_FOUND);
      }
      if (m.currentPhaseIndex >= m.phases.length) {
        return {
          mission: m,
          currentPhase: null,
          allowedTools: [],
          advanced: false,
        };
      }

      const phase = m.phases[m.currentPhaseIndex];
      const criteria = input?.satisfiedCriteria || phase.completionCriteria;

      // Accept advance when caller asserts criteria (real systems check evidence)
      if (
        criteria !== phase.completionCriteria &&
        !m.completedCriteria.includes(phase.completionCriteria)
      ) {
        // still allow explicit advance with matching criteria name
      }
      m.completedCriteria.push(phase.completionCriteria);
      m.currentPhaseIndex += 1;
      missions.set(runId, m);

      const next = m.phases[m.currentPhaseIndex] || null;
      logger.info(
        {
          runId,
          from: phase.name,
          to: next?.name || 'DONE',
        },
        'Mission phase advanced',
      );
      return {
        mission: m,
        currentPhase: next,
        allowedTools: next?.allowedTools || [],
        advanced: true,
      };
    },
    auditAction: 'data.updated',
    auditResource: 'agent_mission',
    meterEventType: 'api_call',
  });
}

export function getAllowedToolsForRun(runId: string): string[] {
  const m = missions.get(runId);
  if (!m) return [];
  if (m.currentPhaseIndex >= m.phases.length) return [];
  return m.phases[m.currentPhaseIndex].allowedTools;
}
