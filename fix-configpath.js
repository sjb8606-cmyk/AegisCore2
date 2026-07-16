const fs = require('fs');
const path = require('path');

const excludedDirs = new Set(['bot-registry', 'bot-runtime', 'aegis-swarm', 'node_modules']);
const fixed = [];
const skipped = [];

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!excludedDirs.has(e.name)) walk(full);
    } else if (e.name === 'index.ts' && full.includes('/src/')) {
      tryFix(full);
    }
  }
}

function tryFix(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('configPath')) return;

  const lines = content.split('\n');
  const constLineIdx = lines.findIndex(l => /const\s+configPath\s*=/.test(l));
  if (constLineIdx === -1) return;

  let tryLine = -1;
  for (let i = constLineIdx; i >= 0; i--) {
    if (/\btry\s*\{/.test(lines[i])) { tryLine = i; break; }
  }
  let catchLine = -1;
  for (let i = constLineIdx; i < Math.min(lines.length, constLineIdx + 15); i++) {
    if (/\}\s*catch/.test(lines[i])) { catchLine = i; break; }
  }
  const declaredInsideTry = tryLine !== -1 && tryLine < constLineIdx;
  const usedInCatch = catchLine !== -1 && lines.slice(catchLine, catchLine + 3).some(l => l.includes('configPath'));

  if (!(declaredInsideTry && usedInCatch)) { skipped.push(filePath); return; }

  const constLineText = lines[constLineIdx].trim();
  const tryIndentMatch = lines[tryLine].match(/^(\s*)/);
  const tryIndent = tryIndentMatch ? tryIndentMatch[1] : '';

  const newLines = [...lines];
  newLines.splice(constLineIdx, 1);
  newLines.splice(tryLine, 0, tryIndent + constLineText);

  fs.writeFileSync(filePath, newLines.join('\n'), 'utf-8');
  fixed.push(filePath);
}

walk('.');
console.log(`Fixed: ${fixed.length}`);
console.log(`Skipped (already correct or different shape): ${skipped.length}`);
