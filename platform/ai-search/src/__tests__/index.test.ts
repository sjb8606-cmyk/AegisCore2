import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { generateMockEmbedding, indexDocument, semanticSearch } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';

function mockConfig(cfg: any) {
  (fs.existsSync as any).mockReturnValue(true);
  (fs.readFileSync as any).mockReturnValue(JSON.stringify(cfg));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('generateMockEmbedding', () => {
  it('is deterministic — same text always produces the same vector', () => {
    const a = generateMockEmbedding('hello world', 16);
    const b = generateMockEmbedding('hello world', 16);
    expect(a).toEqual(b);
  });

  it('produces a vector of the requested dimension', () => {
    expect(generateMockEmbedding('x', 32)).toHaveLength(32);
    expect(generateMockEmbedding('x', 1536)).toHaveLength(1536);
  });

  // KNOWN LIMITATION — documented, function name is honest about this ("Mock").
  // This is a character-code hash, not a real embedding model, so it has no
  // notion of meaning. Two paraphrases of the same idea should be "close" in
  // a real embedding space; here they are not, because the function has no
  // way to know they're related.
  it('LIMITATION: semantically identical sentences do not produce similar vectors', () => {
    const a = generateMockEmbedding('The cat sat on the mat', 64);
    const b = generateMockEmbedding('A feline rested upon the rug', 64);
    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    const cosineSim = dot / (magA * magB);
    expect(cosineSim).toBeLessThan(0.9);
    // TODO(ai-search launch blocker): replace with a real embedding model call
    // before "semantic search" is an accurate name for this feature.
  });
});

describe('indexDocument', () => {
  it('blocks when the vertical is disabled', async () => {
    mockConfig({ enabled: false, tiers: { semanticSearch: true }, limits: { embeddingDimensions: 8 } });
    await expect(indexDocument(TENANT_ID, { entityType: 'doc', content: 'text' })).rejects.toThrow(
      'AI Search vertical is disabled'
    );
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('generates a random entityId when none is provided', async () => {
    mockConfig({ enabled: true, tiers: { semanticSearch: true }, limits: { embeddingDimensions: 8 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'doc-1' }]);

    await indexDocument(TENANT_ID, { entityType: 'doc', content: 'hello' });

    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[3]).toBeTruthy();
  });

  it('uses the provided entityId when one is given', async () => {
    mockConfig({ enabled: true, tiers: { semanticSearch: true }, limits: { embeddingDimensions: 8 } });
    (withTenantQuery as any).mockResolvedValueOnce([{ id: 'doc-1' }]);

    await indexDocument(TENANT_ID, { entityType: 'doc', content: 'hello', entityId: 'existing-entity-id' });

    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[3]).toBe('existing-entity-id');
  });
});

describe('semanticSearch', () => {
  it('blocks when the semanticSearch tier is disabled', async () => {
    mockConfig({ enabled: true, tiers: { semanticSearch: false }, limits: { maxResultsPerQuery: 10, embeddingDimensions: 8 } });
    await expect(semanticSearch(TENANT_ID, 'query text')).rejects.toThrow('Semantic Search is premium-gated');
    expect(withTenantQuery).not.toHaveBeenCalled();
  });

  it('uses the configured default result limit when none is passed', async () => {
    mockConfig({ enabled: true, tiers: { semanticSearch: true }, limits: { maxResultsPerQuery: 7, embeddingDimensions: 8 } });
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await semanticSearch(TENANT_ID, 'query text');

    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[2]).toBe(7);
  });

  it('uses a caller-supplied limit over the configured default', async () => {
    mockConfig({ enabled: true, tiers: { semanticSearch: true }, limits: { maxResultsPerQuery: 7, embeddingDimensions: 8 } });
    (withTenantQuery as any).mockResolvedValueOnce([]);

    await semanticSearch(TENANT_ID, 'query text', 3);

    const params = (withTenantQuery as any).mock.calls[0][1];
    expect(params[2]).toBe(3);
  });
});
