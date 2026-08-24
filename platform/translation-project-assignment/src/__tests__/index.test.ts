import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@platform/utils', () => ({
  loadConfig: vi.fn(() => ({
    enabled: true,
    max_words_per_day: 10000,
    supported_specializations: [
      'general',
      'legal',
      'medical',
      'technical',
      'marketing'
    ]
  }))
}));

vi.mock('@platform/observability', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

vi.mock('@platform/crud-kernel', () => ({
  runCrudOperation: vi.fn(async (options: any) => options.actionFn()),
  AppError: class AppError extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
  ErrorCode: {
    BAD_REQUEST: 'BAD_REQUEST',
    NOT_FOUND: 'NOT_FOUND',
    FORBIDDEN: 'FORBIDDEN',
    CONFLICT: 'CONFLICT'
  }
}));

import {
  createTranslationProject,
  assignLinguist,
  getTranslationProject,
  calculateDeadlineFeasibility,
  __resetTranslationProjectStore
} from '../index';

describe('translation-project-assignment', () => {
  beforeEach(() => {
    __resetTranslationProjectStore();
  });

  it('creates an intake translation project', async () => {
    const project = await createTranslationProject('tenant-1', 'actor-1', {
      client_id: 'client-1',
      source_language: 'en',
      target_language: 'fr',
      specialization: 'legal',
      word_count: 5000,
      deadline: '2099-12-31T00:00:00.000Z'
    });

    expect(project.status).toBe('intake');
    expect(project.source_language).toBe('en');
    expect(getTranslationProject('tenant-1', project.project_id)).toEqual(project);
  });

  it('assigns a linguist and moves the project to assigned', async () => {
    const project = await createTranslationProject('tenant-1', 'actor-1', {
      client_id: 'client-1',
      source_language: 'en',
      target_language: 'fr',
      specialization: 'technical',
      word_count: 2500,
      deadline: '2099-12-31T00:00:00.000Z'
    });

    const assigned = await assignLinguist(
      'tenant-1',
      'actor-1',
      project.project_id,
      'linguist-7'
    );

    expect(assigned.assigned_linguist_id).toBe('linguist-7');
    expect(assigned.status).toBe('assigned');
  });

  it('rejects an invalid zero-word project and handles impossible deadlines', async () => {
    await expect(
      createTranslationProject('tenant-1', 'actor-1', {
        client_id: 'client-1',
        source_language: 'en',
        target_language: 'fr',
        specialization: 'general',
        word_count: 0,
        deadline: '2099-12-31T00:00:00.000Z'
      })
    ).rejects.toThrow('Word count must be greater than zero');

    expect(
      calculateDeadlineFeasibility(
        100000,
        '2000-01-01T00:00:00.000Z'
      )
    ).toBe(false);
  });
});
