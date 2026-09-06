/**
 * @platform/video
 * GAP: many tiers (transcription, aiMeetingSummary, realTimeCaptioning) unused.
 * cachedConfig → vi.resetModules().
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('../../tenancy/src/index', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('../../utils/src/index', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: {
    FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', INTERNAL: 'INTERNAL',
  },
  parseUserId: (id: string) => id,
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

const TENANT = '11111111-1111-1111-1111-111111111111';
const HOST = '22222222-2222-2222-2222-222222222222';
const SESSION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('video', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  async function load() {
    return import('../index');
  }

  it('createSession FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false,
      tiers: { basicVideoCalls: true },
      limits: { maxParticipants: 50, maxRecordingHoursPerMonth: 100, maxConcurrentRooms: 10 },
    }));
    const { VideoService, ErrorCode } = await load();
    await expect(VideoService.createSession(TENANT, { room_name: 'standup' }, HOST))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createSession rejects empty room_name', async () => {
    const { VideoService } = await load();
    await expect(VideoService.createSession(TENANT, { room_name: '' }, HOST)).rejects.toThrow();
  });

  it('createSession inserts scheduled session', async () => {
    const row = { id: SESSION, room_name: 'standup', status: 'scheduled', host_id: HOST };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { VideoService } = await load();
    const result = await VideoService.createSession(TENANT, { room_name: 'standup' }, HOST);
    expect(result).toEqual(row);
  });

  it('startRecording FORBIDDEN when sessionRecording tier off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true,
      tiers: { basicVideoCalls: true, sessionRecording: false },
      limits: { maxParticipants: 50, maxRecordingHoursPerMonth: 100, maxConcurrentRooms: 10 },
    }));
    const { VideoService, ErrorCode } = await load();
    await expect(VideoService.startRecording(TENANT, SESSION))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/recording/i) });
  });

  it('startRecording inserts encrypted recording row', async () => {
    const row = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', session_id: SESSION, encrypted: true };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const { VideoService } = await load();
    const result = await VideoService.startRecording(TENANT, SESSION);
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[0][0]).toMatch(/video_recordings/i);
  });

  it('fetchSessions returns list', async () => {
    const rows = [{ id: SESSION, room_name: 'standup', status: 'scheduled' }];
    mockWithTenantQuery.mockResolvedValueOnce(rows);
    const { VideoService } = await load();
    expect(await VideoService.fetchSessions(TENANT)).toEqual(rows);
  });
});
