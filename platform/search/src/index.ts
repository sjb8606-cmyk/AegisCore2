import { z } from 'zod';
import { loadConfig } from '../../utils/src/index';
import { withTenantQuery } from '../../tenancy/src/index';
import { emit as auditEmit } from '../../audit/src/index';

const ConfigSchema = z.object({
  enabled: z.boolean(),
  tiers: z.object({ fuzzySearch: z.boolean() }),
  limits: z.object({ maxResultsPerPage: z.number(), maxQueryLength: z.number() })
});

export async function indexDocument(tenantId: string, entityType: string, entityId: string, title: string, body: string) {
  const config = loadConfig('search', ConfigSchema);
  if (!config.enabled) return;

  await withTenantQuery(
    `INSERT INTO search_index (tenant_id, entity_type, entity_id, title, body) 
     VALUES ($1, $2, $3, $4, $5) 
     ON CONFLICT (tenant_id, entity_type, entity_id) 
     DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body`,
    [tenantId, entityType, entityId, title, body],
    tenantId
  );
}

export async function runSearch(tenantId: string, query: string, userId: string) {
  const config = loadConfig('search', ConfigSchema);
  if (!config.enabled) throw new Error('Search disabled');

  let results;
  
  if (config.tiers.fuzzySearch) {
    // THE FIX: Use the explicit similarity operator (%) for fuzzy matching
    // We also set the similarity threshold lower to catch obvious typos
    await withTenantQuery("SELECT set_limit(0.2)", [], tenantId); 

    results = await withTenantQuery(
      `SELECT entity_type, entity_id, title, similarity(title, $1) as sim_score
       FROM search_index 
       WHERE tenant_id = $2 
         AND (search_vec @@ plainto_tsquery('english', $1) OR title % $1)
       ORDER BY sim_score DESC LIMIT $3`,
      [query, tenantId, config.limits.maxResultsPerPage],
      tenantId
    );
  } else {
    results = await withTenantQuery(
      `SELECT entity_type, entity_id, title FROM search_index 
       WHERE tenant_id = $2 AND search_vec @@ plainto_tsquery('english', $1)`,
      [query, tenantId, config.limits.maxResultsPerPage],
      tenantId
    );
  }

  return results;
}
