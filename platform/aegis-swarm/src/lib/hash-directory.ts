/**
 * platform/aegis-swarm/src/lib/hash-directory.ts
 *
 * Shared "hash every file in a directory" helper used by any bot that
 * compares current state against a known-good baseline (D-20 Config
 * Drift Detector, D-17 Build Integrity Verifier, and future bots in
 * that family).
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'coverage',
  '.next',
]);

export function hashDirectory(
  rootDir: string,
  excludedDirs: Set<string> = DEFAULT_EXCLUDED_DIRS,
): Record<string, string> {
  const hashes: Record<string, string> = {};

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirs.has(entry.name)) walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(rootDir, fullPath);
        const content = fs.readFileSync(fullPath);
        hashes[relPath] = crypto.createHash('sha256').update(content).digest('hex');
      }
    }
  };

  walk(rootDir);
  return hashes;
}
