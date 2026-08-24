import fs from 'fs';
import path from 'path';

const PERSONA_DIR = path.join(process.cwd(), 'config', 'personas');

const DEFAULT_CAPS = {
  chatbot: { enabled: true },
  bot: { enabled: false, triggerConditions: [], permissionScope: ['read:filesystem'] },
  agent: { enabled: false, permissionScope: [], hardStops: [
    'Never takes real-world action without HITL approval',
    'Never modifies data outside declared permissionScope'
  ] }
};

let updated = 0, skipped = 0, errored = 0;
const errors = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!entry.name.endsWith('.json')) continue;

    try {
      const raw = fs.readFileSync(full, 'utf-8');
      const data = JSON.parse(raw);
      if (data.capabilities) { skipped++; continue; }
      data.capabilities = DEFAULT_CAPS;
      fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n');
      updated++;
    } catch (err) {
      errored++;
      errors.push(`${full}: ${err.message}`);
    }
  }
}

if (!fs.existsSync(PERSONA_DIR)) {
  console.error(`No persona dir at ${PERSONA_DIR}. Run this from repo root.`);
  process.exit(1);
}

walk(PERSONA_DIR);

console.log(`\nPersona capabilities migration complete.`);
console.log(`  Updated: ${updated}`);
console.log(`  Skipped (already had capabilities): ${skipped}`);
console.log(`  Errored: ${errored}`);
if (errors.length) {
  console.log(`\nFirst 10 errors:`);
  errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
}
