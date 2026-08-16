#!/usr/bin/env node
/**
 * scripts/create-core.js
 *
 * Usage:
 *   node scripts/create-core.js --name loyalty-rewards
 *   node scripts/create-core.js --name temperature-alerts --path fisheries
 *
 * Creates platform/<name>/ with a real, working skeleton: src/index.ts,
 * src/__tests__/index.test.ts, package.json — already wired to the
 * shared primitives instead of hand-retyping the same boilerplate.
 */

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--name') out.name = args[++i];
    if (args[i] === '--path') out.subpath = args[++i];
  }
  return out;
}

const { name, subpath } = parseArgs();

if (!name) {
  console.error('Usage: node scripts/create-core.js --name <core-name> [--path <subfolder, e.g. fisheries>]');
  process.exit(1);
}

const repoRoot = path.join(__dirname, '..');
const coreDir = subpath
  ? path.join(repoRoot, 'platform', subpath, name)
  : path.join(repoRoot, 'platform', name);
const aliasPath = subpath
  ? `./platform/${subpath}/${name}/src/index.ts`
  : `./platform/${name}/src/index.ts`;
const aliasName = `@platform/${name}`;

if (fs.existsSync(coreDir)) {
  console.error(`platform/${subpath ? subpath + '/' : ''}${name} already exists — refusing to overwrite. Delete it first if you really want to regenerate.`);
  process.exit(1);
}

fs.mkdirSync(path.join(coreDir, 'src', '__tests__'), { recursive: true });

const indexContent = `import { z } from 'zod';
import { runCrudOperation, AppError, ErrorCode } from '@platform/crud-kernel';
import { enforceQuota } from '@platform/quota-guard';
import { withTenantQuery } from '@platform/tenancy';

export { AppError, ErrorCode };

const ConfigSchema = z.object({
  enabled: z.boolean(),
  limits: z.object({
    // TODO: name your real limit field, e.g. recordsPerMonth: z.number()
  }),
});

/**
 * TODO: rename this function and fill in the real business logic below.
 * This follows the AegisCore Bible's five-step core shape, already wired
 * to the shared primitives — replace every TODO with the real table
 * name, real quota field, and real columns for this core.
 */
export async function createRecord(tenantId: string, actorId: string, data: any) {
  return runCrudOperation({
    configName: '${name}',
    configSchema: ConfigSchema,
    tenantId,
    actorId,
    checkQuota: async (config: any) => {
      const countRes = await withTenantQuery(
        'SELECT COUNT(*) as count FROM TODO_TABLE_NAME WHERE tenant_id = $1',
        [tenantId],
        tenantId,
      );
      enforceQuota(countRes[0]?.count, config.limits.TODO_LIMIT_FIELD, 'TODO: your real quota message here');
    },
    action: async () => {
      const { randomUUID } = await import('crypto');
      const result = await withTenantQuery(
        'INSERT INTO TODO_TABLE_NAME (id, tenant_id /* TODO: real columns */) VALUES (\$1, \$2) RETURNING *',
        [randomUUID(), tenantId /* TODO: real values */],
        tenantId,
      );
      return result[0];
    },
    auditAction: '${name}.record.created', // TODO: must be a real value in platform/audit's AuditAction enum
    auditResource: 'record',
    meterEventType: 'api_call', // TODO: remove this line entirely if this operation isn't billable
  });
}
`;

const testContent = `import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@platform/tenancy', () => ({
  withTenantQuery: vi.fn(),
}));

vi.mock('@platform/audit', () => ({
  emit: vi.fn(),
}));

vi.mock('@platform/metering', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@platform/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@platform/utils')>();
  return { ...actual, loadConfig: vi.fn() };
});

import { createRecord } from '../index';
import { withTenantQuery } from '@platform/tenancy';
import { loadConfig } from '@platform/utils';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ACTOR_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  (loadConfig as any).mockReturnValue({ enabled: true, limits: { /* TODO: real limits */ } });
  (withTenantQuery as any).mockImplementation((sql: string) => {
    if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '0' }]);
    return Promise.resolve([{ id: 'record-1' }]);
  });
});

describe('${name}.createRecord', () => {
  it('TODO: write real tests for the real business logic', async () => {
    const result = await createRecord(TENANT_ID, ACTOR_ID, { /* TODO: real input */ });
    expect(result).toBeDefined();
  });

  it('TODO: test the disabled-config case', async () => {
    (loadConfig as any).mockReturnValue({ enabled: false });
    await expect(createRecord(TENANT_ID, ACTOR_ID, {})).rejects.toThrow();
  });

  it('TODO: test the quota-exceeded case', async () => {
    (withTenantQuery as any).mockImplementation((sql: string) => {
      if (sql.includes('SELECT COUNT')) return Promise.resolve([{ count: '9999' }]);
      return Promise.resolve([{ id: 'record-1' }]);
    });
    await expect(createRecord(TENANT_ID, ACTOR_ID, {})).rejects.toThrow();
  });
});
`;

const packageJsonContent = JSON.stringify({
  name: aliasName,
  version: '0.1.0',
  private: true,
  main: 'src/index.ts',
  scripts: { test: 'vitest run', 'test:coverage': 'vitest run --coverage' },
  dependencies: { zod: '^3.23.0' },
  devDependencies: { vitest: '^1.6.0' },
}, null, 2) + '\n';

fs.writeFileSync(path.join(coreDir, 'src', 'index.ts'), indexContent);
fs.writeFileSync(path.join(coreDir, 'src', '__tests__', 'index.test.ts'), testContent);
fs.writeFileSync(path.join(coreDir, 'package.json'), packageJsonContent);

const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
const tsconfigRaw = fs.readFileSync(tsconfigPath, 'utf-8');
if (!tsconfigRaw.includes(`"${aliasName}"`)) {
  const aliasLine = `      "${aliasName}": ["${aliasPath}"],\n`;
  const updated = tsconfigRaw.replace(
    /("compilerOptions"[\s\S]*?"paths"\s*:\s*{\n)/,
    `$1${aliasLine}`,
  );
  fs.writeFileSync(tsconfigPath, updated);
  console.log(`✅ Added ${aliasName} alias to tsconfig.json`);
} else {
  console.log(`ℹ️  ${aliasName} alias already exists in tsconfig.json, left unchanged`);
}

console.log(`\n✅ Created platform/${subpath ? subpath + '/' : ''}${name}/`);
console.log(`   - src/index.ts (5 TODOs to fill in)`);
console.log(`   - src/__tests__/index.test.ts (3 starter tests)`);
console.log(`   - package.json`);
console.log(`\nNext: fill in the TODOs, then run:`);
console.log(`   cd platform/${subpath ? subpath + '/' : ''}${name} && npx vitest run`);
