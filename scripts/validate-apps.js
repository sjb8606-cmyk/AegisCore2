#!/usr/bin/env node
/**
 * AegisCore — App Config Validator
 * Validates all JSON files in config/apps/ against the required schema.
 * Run: node scripts/validate-apps.js
 */

const fs = require('fs');
const path = require('path');

const REQUIRED_TOP = ['app_id', 'name', 'tenant_id', 'status', 'cores', 'config', 'routes'];
const VALID_CORES = [
  'delight', 'ai-safety', 'audit', 'subscriptions', 'metering', 'analytics',
  'inventory', 'logistics', 'compliance', 'scheduling', 'ai-reports', 'ai-chat',
  'payments', 'notifications', 'crm', 'helpdesk', 'onboarding', 'webhooks',
  'feature-flags', 'white-label', 'workflows', 'versioning', 'tenancy'
];

const appsDir = path.join(__dirname, '../config/apps');
const files = fs.readdirSync(appsDir).filter(f => f.endsWith('.json'));

let passed = 0, failed = 0;

console.log('\n═══════════════════════════════════════');
console.log(' AegisCore — App Config Validator');
console.log('═══════════════════════════════════════\n');

for (const file of files) {
  const fPath = path.join(appsDir, file);
  let app;
  try {
    app = JSON.parse(fs.readFileSync(fPath, 'utf-8'));
  } catch (e) {
    console.error(`❌ ${file}: Invalid JSON — ${e.message}`);
    failed++;
    continue;
  }

  const errors = [];
  for (const field of REQUIRED_TOP) {
    if (app[field] === undefined) errors.push(`Missing field: ${field}`);
  }

  // Validate cores reference known platform cores
  if (app.cores) {
    for (const core of app.cores) {
      if (!VALID_CORES.includes(core)) {
        errors.push(`Unknown core: "${core}" — check platform/ directory`);
      }
    }
  }

  // Validate routes have path + method
  if (app.routes) {
    app.routes.forEach((r, i) => {
      if (!r.path) errors.push(`Route[${i}] missing path`);
      if (!r.method) errors.push(`Route[${i}] missing method`);
    });
  }

  if (errors.length === 0) {
    console.log(`✅ ${file} (${app.name}) — ${app.cores.length} cores, ${app.routes.length} routes`);
    passed++;
  } else {
    console.log(`❌ ${file} (${app.name || 'unknown'})`);
    errors.forEach(e => console.log(`   └─ ${e}`));
    failed++;
  }
}

console.log(`\n───────────────────────────────────────`);
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log(`═══════════════════════════════════════\n`);
process.exit(failed > 0 ? 1 : 0);
