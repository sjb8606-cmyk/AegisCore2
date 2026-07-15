/**
 * platform/bot-registry/src/loader.ts
 *
 * Scans a directory of bot JSON specs, validates each against
 * BotSpecificationSchema, rejects anything matching an adversarial
 * fingerprint, and builds an in-memory registry. This is the loader
 * that AegisSwarm's runtime (CrystalBot base class, built next) reads
 * from — it does not execute bots, it only loads and validates them.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getLogger } from '@platform/observability';
import { emit as auditEmit } from '@platform/audit';
import {
  BotSpecificationSchema,
  BotSpecification,
  BotValidationResult,
  containsAdversarialFingerprint,
} from './schema';

const logger = getLogger('bot-registry:loader');

// System-level actor for audit events emitted by the registry itself
// (bot loading isn't a tenant-scoped action — it's a platform action).
const SYSTEM_TENANT_ID = process.env.AEGIS_SYSTEM_TENANT_ID || 'system';
const SYSTEM_ACTOR_ID = 'bot-registry';

/**
 * Smart root resolution, same pattern used by loadConfig() and the
 * Delight Engine persona loader: walk up from cwd until we find
 * /config, so this works whether it's invoked from repo root or from
 * inside a nested workspace package.
 */
function resolveBotDir(): string {
  let currentPath = process.cwd();
  let botDir = path.join(currentPath, 'config', 'bots');

  while (!fs.existsSync(botDir) && currentPath !== path.parse(currentPath).root) {
    currentPath = path.dirname(currentPath);
    botDir = path.join(currentPath, 'config', 'bots');
  }
  return botDir;
}

async function logSpecLoaded(bot: BotSpecification, filePath: string): Promise<void> {
  await auditEmit({
    tenantId: SYSTEM_TENANT_ID,
    actorId: SYSTEM_ACTOR_ID,
    actorType: 'system',
    action: 'bot.spec_loaded',
    outcome: 'success',
    resource: 'bot_specification',
    resourceId: bot.proposedBotId,
    description: `Loaded and validated bot spec ${bot.proposedBotId}`,
    metadata: { filePath, hitlClassification: bot.hitlClassification },
  });
}

async function logSpecRejected(filePath: string, reason: string): Promise<void> {
  await auditEmit({
    tenantId: SYSTEM_TENANT_ID,
    actorId: SYSTEM_ACTOR_ID,
    actorType: 'system',
    action: 'bot.spec_rejected',
    outcome: 'failure',
    resource: 'bot_specification',
    description: reason,
    metadata: { filePath },
  });
}

/**
 * Validates a single bot spec file's raw content. Exported separately
 * from directory scanning so it can be unit tested and reused (e.g.
 * by the Replicator when it proposes a new bot).
 */
export async function validateBotSpecContent(
  rawContent: string,
  filePath: string,
): Promise<BotValidationResult> {
  // 1. Adversarial fingerprint check runs on raw content, before parsing.
  const fingerprint = containsAdversarialFingerprint(rawContent);
  if (fingerprint) {
    const reason = `Rejected: matched adversarial fingerprint "${fingerprint}"`;
    logger.error({ filePath, fingerprint }, reason);
    await logSpecRejected(filePath, reason);
    return { valid: false, filePath, reason };
  }

  // 2. Parse JSON.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch (err) {
    const reason = `Invalid JSON: ${(err as Error).message}`;
    await logSpecRejected(filePath, reason);
    return { valid: false, filePath, reason };
  }

  // 3. Schema validation.
  const result = BotSpecificationSchema.safeParse(parsed);
  if (!result.success) {
    const reason = `Schema validation failed: ${result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')}`;
    logger.error({ filePath, issues: result.error.issues }, reason);
    await logSpecRejected(filePath, reason);
    return { valid: false, filePath, reason };
  }

  await logSpecLoaded(result.data, filePath);
  return { valid: true, bot: result.data, filePath };
}

/**
 * In-memory registry of validated bot specs. Load once at startup
 * (or on demand for testing); the swarm runtime reads from this
 * rather than touching the filesystem on every action.
 */
export class BotRegistry {
  private bots = new Map<string, BotSpecification>();
  private rejections: Array<{ filePath: string; reason: string }> = [];

  /**
   * Scans the given directory (defaults to config/bots) for *.json
   * files, validates each, and populates the registry. Returns a
   * summary so the caller (or a human reviewing a report) can see
   * exactly what loaded and what didn't, without digging into logs.
   */
  async loadFromDirectory(dirOverride?: string): Promise<{
    loaded: number;
    rejected: number;
    bots: BotSpecification[];
    rejections: Array<{ filePath: string; reason: string }>;
  }> {
    const dir = dirOverride || resolveBotDir();

    if (!fs.existsSync(dir)) {
      logger.warn({ dir }, 'Bot directory does not exist yet — registry will be empty');
      return { loaded: 0, rejected: 0, bots: [], rejections: [] };
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const loadedBots: BotSpecification[] = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, 'utf-8');
      const result = await validateBotSpecContent(raw, filePath);

      if (result.valid) {
        if (this.bots.has(result.bot.proposedBotId)) {
          const reason = `Duplicate bot ID "${result.bot.proposedBotId}" — already registered from another file`;
          this.rejections.push({ filePath, reason });
          logger.error({ filePath }, reason);
          continue;
        }
        this.bots.set(result.bot.proposedBotId, result.bot);
        loadedBots.push(result.bot);
      } else {
        this.rejections.push({ filePath: result.filePath, reason: result.reason });
      }
    }

    logger.info(
      { loaded: loadedBots.length, rejected: this.rejections.length, dir },
      'Bot registry load complete',
    );

    return {
      loaded: loadedBots.length,
      rejected: this.rejections.length,
      bots: loadedBots,
      rejections: this.rejections,
    };
  }

  getBot(botId: string): BotSpecification | undefined {
    return this.bots.get(botId);
  }

  listBots(): BotSpecification[] {
    return Array.from(this.bots.values());
  }

  listByHitlClassification(cls: BotSpecification['hitlClassification']): BotSpecification[] {
    return this.listBots().filter((b) => b.hitlClassification === cls);
  }

  getRejections(): Array<{ filePath: string; reason: string }> {
    return this.rejections;
  }

  size(): number {
    return this.bots.size;
  }
}
