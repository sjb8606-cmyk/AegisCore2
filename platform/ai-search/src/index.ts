import { withTenantQuery } from '@platform/tenancy';
import * as fs from 'fs';
import * as path from 'path';
import { AppError, ErrorCode } from '@platform/utils';

export function parseUserId(userId: any): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId === 'string' && uuidRegex.test(userId)) return userId;
  throw new AppError(`Invalid or missing user id: ${JSON.stringify(userId)}`, ErrorCode.BAD_REQUEST);
}

function loadConfig() {
  const configPath = path.join(process.cwd(), 'config', 'ai-search.json');
  try {
    if (fs.existsSync(configPath)) return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) { console.warn(`Config file at ${configPath} failed to load or parse, falling back to defaults:`, err); }
  return { enabled: true, tiers: { semanticSearch: true }, limits: { maxResultsPerQuery: 10, embeddingDimensions: 1536 } };
}

// Deterministic 1536-Dimension Vector Simulator
export function generateMockEmbedding(text: string, dimensions: number = 1536): number[] {
  const vector: number[] = [];
  const baseLen = text.length;
  for (let i = 0; i < dimensions; i++) {
    const charCode = text.charCodeAt(i % baseLen) || 1;
    vector.push(parseFloat((Math.sin(charCode + i) * 0.1).toFixed(6)));
  }
  return vector;
}

export async function indexDocument(tenantId: string, data: any) {
  const cfg = loadConfig();
  if (!cfg.enabled) throw new AppError('AI Search vertical is disabled', ErrorCode.FORBIDDEN);

  const embedding = generateMockEmbedding(data.content, cfg.limits.embeddingDimensions);
  const docId = crypto.randomUUID();
  const entityId = data.entityId || crypto.randomUUID();

  // Convert number array to PostgreSQL double precision array syntax '{0.1, 0.2, ...}'
  const pgArrayString = `{${embedding.join(',')}}`;

  const insertQuery = `
    INSERT INTO search_embeddings (id, tenant_id, entity_type, entity_id, content, embedding, metadata)
    VALUES ($1, $2, $3, $4, $5, $6::double precision[], $7) RETURNING *;
  `;
  const result = await withTenantQuery(insertQuery, [
    docId, tenantId, data.entityType, entityId, data.content, pgArrayString, JSON.stringify(data.metadata || {})
  ], tenantId);

  return result[0];
}

export async function semanticSearch(tenantId: string, query: string, limit?: number) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.tiers.semanticSearch) {
    throw new AppError('Semantic Search is premium-gated', ErrorCode.FORBIDDEN);
  }

  const queryVector = generateMockEmbedding(query, cfg.limits.embeddingDimensions);
  const pgArrayString = `{${queryVector.join(',')}}`;
  const maxResults = limit || cfg.limits.maxResultsPerQuery;

  // Execute native cosine similarity comparison index lookup
  const results = await withTenantQuery(`
    SELECT id, entity_type, entity_id, content, cosine_similarity(embedding, $1::double precision[]) as similarity
    FROM search_embeddings 
    WHERE tenant_id = $2
    ORDER BY similarity DESC 
    LIMIT $3;
  `, [pgArrayString, tenantId, maxResults], tenantId);

  return results;
}
