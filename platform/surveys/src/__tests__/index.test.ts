/**
 * @platform/surveys
 * Real NPS math: ((promoters - detractors) / total) * 100.
 * Quota + active status gates on submit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));
vi.mock('@platform/utils', () => ({
  AppError: class AppError extends Error {
    constructor(message: string, public code: string) { super(message); this.name = 'AppError'; }
  },
  ErrorCode: { FORBIDDEN: 'FORBIDDEN', BAD_REQUEST: 'BAD_REQUEST', NOT_FOUND: 'NOT_FOUND' },
  parseUserId: (id: string) => id,
}));
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

import {
  createSurvey, submitSurveyResponse, calculateNpsScore, AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const SURVEY = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('surveys', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createSurvey FORBIDDEN when disabled', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: {}, limits: { surveyCount: 50, questionsPerSurvey: 20 },
    }));
    await expect(createSurvey(TENANT, USER, { title: 'CSAT', questions: [] }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createSurvey FORBIDDEN at surveyCount limit', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '50' }]);
    await expect(createSurvey(TENANT, USER, { title: 'CSAT', questions: [{ id: 1 }] }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/Survey limit/i) });
  });

  it('createSurvey BAD_REQUEST when questions exceed limit', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]);
    const questions = Array.from({ length: 21 }, (_, i) => ({ id: i, text: `Q${i}` }));
    await expect(createSurvey(TENANT, USER, { title: 'Too many', questions }))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST });
  });

  it('createSurvey inserts active survey', async () => {
    const row = { id: SURVEY, title: 'NPS Q1', status: 'active', type: 'nps' };
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([row]);
    const result = await createSurvey(TENANT, USER, {
      title: 'NPS Q1', type: 'nps', questions: [{ id: 1, text: 'How likely?' }],
    });
    expect(result).toEqual(row);
  });

  it('submitSurveyResponse NOT_FOUND / inactive / quota', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(submitSurveyResponse(TENANT, SURVEY, { answers: { q1: 9 } }, {}))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });

    mockWithTenantQuery.mockResolvedValueOnce([{
      id: SURVEY, type: 'nps', status: 'closed', response_count: 0, response_quota: null,
    }]);
    await expect(submitSurveyResponse(TENANT, SURVEY, { answers: { q1: 9 } }, {}))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/no longer active/i) });

    mockWithTenantQuery.mockResolvedValueOnce([{
      id: SURVEY, type: 'nps', status: 'active', response_count: 10, response_quota: 10,
    }]);
    await expect(submitSurveyResponse(TENANT, SURVEY, { answers: { q1: 9 } }, {}))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/quota/i) });
  });

  it('submitSurveyResponse extracts NPS score and increments count', async () => {
    const response = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', nps_score: 9 };
    mockWithTenantQuery
      .mockResolvedValueOnce([{
        id: SURVEY, type: 'nps', status: 'active', response_count: 0, response_quota: 100, is_anonymous: true,
      }])
      .mockResolvedValueOnce([response])
      .mockResolvedValueOnce([]);
    const result = await submitSurveyResponse(TENANT, SURVEY, { answers: { score: 9 } }, { ip: '1.2.3.4' });
    expect(result.nps_score).toBe(9);
    expect(mockWithTenantQuery.mock.calls[1][1][4]).toBe(9); // nps_score param
  });

  it('calculateNpsScore FORBIDDEN when tier off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true, tiers: { npsCalculation: false }, limits: { surveyCount: 50, questionsPerSurvey: 20 },
    }));
    await expect(calculateNpsScore(TENANT, SURVEY))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('calculateNpsScore computes classic NPS', async () => {
    // scores: 10,9 (promoters), 8,7 (passives), 6,0 (detractors) → (2-2)/6 * 100 = 0
    mockWithTenantQuery.mockResolvedValueOnce([
      { nps_score: 10 }, { nps_score: 9 }, { nps_score: 8 },
      { nps_score: 7 }, { nps_score: 6 }, { nps_score: 0 },
    ]);
    const result = await calculateNpsScore(TENANT, SURVEY);
    expect(result).toEqual({
      score: 0, promoters: 2, passives: 2, detractors: 2, total: 6,
    });
  });

  it('calculateNpsScore returns 0 when no scores', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    const result = await calculateNpsScore(TENANT, SURVEY);
    expect(result.score).toBe(0);
    expect(result.total).toBe(0);
  });
});
