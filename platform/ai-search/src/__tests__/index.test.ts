import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWithTenantQuery = vi.fn();
const mockFsExists = vi.fn();
const mockFsRead = vi.fn();

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: (...a: unknown[]) => mockWithTenantQuery(...a),
}));

vi.mock('fs', () => ({
  existsSync: (...a: unknown[]) => mockFsExists(...a),
  readFileSync: (...a: unknown[]) => mockFsRead(...a),
}));

import { generateMockEmbedding, indexDocument, semanticSearch } from '../index';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function mockConfig(cfg: any) {
  mockFsExists.mockReturnValue(true);
  mockFsRead.mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig({
    enabled: true,
    tiers: { semanticSearch: true },
    limits: { maxResultsPerQuery: 10, embeddingDimensions: 1536 },
  });
});

describe('generateMockEmbedding', () => {
  it('throws NOT_IMPLEMENTED instead of returning a sine-wave vector', () => {
    expect(() => generateMockEmbedding('hello')).toThrow(/NOT_IMPLEMENTED/);
  });
});

describe('indexDocument', () => {
  it('throws when the vertical is disabled', async () => {
    mockConfig({ enabled: false, tiers: { semanticSearch: true }, limits: { maxResultsPerQuery: 10, embeddingDimensions: 1536 } });
    await expect(indexDocument(TENANT_ID, { content: 'test', entityType: 'doc' })).rejects.toThrow(
      'AI Search vertical is disabled'
    );
  });

  it('throws NOT_IMPLEMENTED because real embeddings are not wired', async () => {
    await expect(indexDocument(TENANT_ID, { content: 'test', entityType: 'doc' })).rejects.toThrow(
      /NOT_IMPLEMENTED/
    );
  });
});

describe('semanticSearch', () => {
  it('blocks when the semanticSearch tier is disabled', async () => {
    mockConfig({
      enabled: true,
      tiers: { semanticSearch: false },
      limits: { maxResultsPerQuery: 10, embeddingDimensions: 1536 },
    });
    await expect(semanticSearch(TENANT_ID, 'query')).rejects.toThrow(
      'Semantic Search is premium-gated'
    );
  });

  it('throws NOT_IMPLEMENTED because real embeddings are not wired', async () => {
    await expect(semanticSearch(TENANT_ID, 'query')).rejects.toThrow(/NOT_IMPLEMENTED/);
  });
});
