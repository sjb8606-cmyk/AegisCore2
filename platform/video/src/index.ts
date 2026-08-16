import { parseUserId } from '@platform/utils';
import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { withTenantQuery } from '../../tenancy/src/index';
import { AppError, ErrorCode } from '../../utils/src/index';
export { AppError, ErrorCode };

export const VideoSessionSchema = z.object({
  room_name: z.string().min(1),
  host_id: z.string().uuid().optional(),
});

export const JoinSessionSchema = z.object({
  session_id: z.string().uuid(),
});

export const VideoConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({
    basicVideoCalls: z.boolean().default(true),
    multiParticipantRooms: z.boolean().default(true),
    screenSharing: z.boolean().default(true),
    sessionRecording: z.boolean().default(true),
    participantRoles: z.boolean().default(true),
    meetingScheduling: z.boolean().default(true),
    chatDuringCall: z.boolean().default(true),
    callAnalytics: z.boolean().default(false),
    transcription: z.boolean().default(false),
    aiMeetingSummary: z.boolean().default(false),
    realTimeCaptioning: z.boolean().default(false),
    recordingEncryption: z.boolean().default(true),
    enterpriseComplianceMode: z.boolean().default(false),
    auditTrail: z.boolean().default(true),
  }),
  limits: z.object({
    maxParticipants: z.number().default(50),
    maxRecordingHoursPerMonth: z.number().default(100),
    maxConcurrentRooms: z.number().default(10),
  }),
});

export type VideoConfig = z.infer<typeof VideoConfigSchema>;

let cachedConfig: VideoConfig | null = null;

export function loadConfig(): VideoConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'config/video.json');
  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf8');
      cachedConfig = VideoConfigSchema.parse(JSON.parse(raw));
      return cachedConfig;
    }
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }

  cachedConfig = VideoConfigSchema.parse({
    enabled: true,
    tiers: {
      basicVideoCalls: true,
      multiParticipantRooms: true,
      screenSharing: true,
      sessionRecording: true,
      participantRoles: true,
      meetingScheduling: true,
      chatDuringCall: true,
      callAnalytics: false,
      transcription: false,
      aiMeetingSummary: false,
      realTimeCaptioning: false,
      recordingEncryption: true,
      enterpriseComplianceMode: false,
      auditTrail: true,
    },
    limits: {
      maxParticipants: 50,
      maxRecordingHoursPerMonth: 100,
      maxConcurrentRooms: 10,
    }
  });
  return cachedConfig;
}

export class VideoService {
  static async createSession(tenantId: string, data: any, hostId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Video orchestration is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.basicVideoCalls) {
      throw new AppError('Video calls are blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const session = VideoSessionSchema.parse(data);
    const cleanHostId = parseUserId(hostId);

    const sql = `
      INSERT INTO video_sessions (tenant_id, host_id, room_name, status)
      VALUES ($1::uuid, $2::uuid, $3, 'scheduled')
      RETURNING *
    `;
    const params = [tenantId, cleanHostId, session.room_name];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to record video session', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async startRecording(tenantId: string, sessionId: string) {
    const config = loadConfig();
    if (!config.enabled) {
      throw new AppError('Video orchestration is globally disabled', ErrorCode.FORBIDDEN);
    }

    if (!config.tiers.sessionRecording) {
      throw new AppError('Session recording is blocked on current tier', ErrorCode.FORBIDDEN);
    }

    const sql = `
      INSERT INTO video_recordings (tenant_id, session_id, encrypted)
      VALUES ($1::uuid, $2::uuid, true)
      RETURNING *
    `;
    const params = [tenantId, sessionId];

    const rows = await withTenantQuery(sql, params, tenantId);
    if (!rows || rows.length === 0) {
      throw new AppError('Failed to initiate recording session', ErrorCode.INTERNAL);
    }

    return rows[0];
  }

  static async fetchSessions(tenantId: string): Promise<any[]> {
    const sql = `
      SELECT id, host_id, room_name, status, started_at, ended_at, created_at 
      FROM video_sessions 
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return await withTenantQuery(sql, [tenantId], tenantId);
  }
}
