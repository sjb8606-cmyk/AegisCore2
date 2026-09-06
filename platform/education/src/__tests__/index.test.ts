/**
 * @platform/education
 * DEFECT: completeLesson always sets progress_percent = 100 regardless of lessons remaining.
 * LIMITATION: generateCertificate returns a hardcoded minimal PDF buffer (no pdfkit).
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
  createCourse, createLesson, enrollStudent, completeLesson, generateCertificate,
  AppError, ErrorCode,
} from '../index';

const TENANT = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
const COURSE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LESSON = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ENROLL = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

describe('education', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('createCourse FORBIDDEN when disabled or at limit', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: false, tiers: { certificates: true }, limits: { courseCount: 10, studentCount: 500 },
    }));
    await expect(createCourse(TENANT, USER, { title: 'Intro JS' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('createCourse FORBIDDEN at courseCount limit', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '10' }]);
    await expect(createCourse(TENANT, USER, { title: 'Intro JS' }))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN, message: expect.stringMatching(/Course limit/i) });
  });

  it('createCourse inserts published course with slug', async () => {
    const row = { id: COURSE, title: 'Intro JS', slug: 'intro-js', status: 'published' };
    mockWithTenantQuery.mockResolvedValueOnce([{ count: '0' }]).mockResolvedValueOnce([row]);
    const result = await createCourse(TENANT, USER, { title: 'Intro JS', price_cents: 0 });
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[1][1][5]).toBe('intro-js');
  });

  it('createLesson inserts lesson', async () => {
    const row = { id: LESSON, title: 'Variables', type: 'text' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await createLesson(TENANT, COURSE, { title: 'Variables', type: 'text' });
    expect(result).toEqual(row);
  });

  it('enrollStudent inserts enrollment and increments student_count', async () => {
    const row = { id: ENROLL, course_id: COURSE, student_id: USER };
    // enrollStudent's first DB call is the student-count check, THEN the
    // insert, THEN the UPDATE -- the count-check mock was missing, which
    // shifted every later mocked value one call too early.
    mockWithTenantQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([]);
    const result = await enrollStudent(TENANT, COURSE, USER);
    expect(result).toEqual(row);
    expect(mockWithTenantQuery.mock.calls[2][0]).toMatch(/student_count = student_count \+ 1/i);
  });

  it('completeLesson sets progress_percent=100 always (DEFECT)', async () => {
    const row = { id: ENROLL, progress_percent: 100, completed_at: '2026-01-01' };
    mockWithTenantQuery.mockResolvedValueOnce([row]);
    const result = await completeLesson(TENANT, ENROLL, LESSON);
    expect(result.progress_percent).toBe(100);
  });

  it('completeLesson NOT_FOUND when enrollment missing', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(completeLesson(TENANT, ENROLL, LESSON))
      .rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
  });

  it('generateCertificate FORBIDDEN when tier off', async () => {
    const fs = await import('fs');
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(JSON.stringify({
      enabled: true, tiers: { certificates: false }, limits: { courseCount: 10, studentCount: 500 },
    }));
    await expect(generateCertificate(TENANT, ENROLL))
      .rejects.toMatchObject({ code: ErrorCode.FORBIDDEN });
  });

  it('generateCertificate BAD_REQUEST when not completed', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([]);
    await expect(generateCertificate(TENANT, ENROLL))
      .rejects.toMatchObject({ code: ErrorCode.BAD_REQUEST, message: expect.stringMatching(/not completed/i) });
  });

  it('generateCertificate returns minimal PDF buffer (LIMITATION)', async () => {
    mockWithTenantQuery.mockResolvedValueOnce([{ id: ENROLL }]);
    const buf = await generateCertificate(TENANT, ENROLL);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toMatch(/%PDF-1\.4/);
  });
});
