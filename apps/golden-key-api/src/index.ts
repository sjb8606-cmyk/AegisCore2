/**
 * apps/golden-key-api
 *
 * Thin entrypoint for Golden Key.
 * Assembles cores declared in config/apps/golden-key.json via mountApp().
 * Does NOT auto-discover routes. Does NOT duplicate business logic.
 *
 * Pattern: copy of tidelock-api compliance (AegisCore Bible §2).
 */

import express from 'express';
import { mountApp } from '@platform/app-loader';
import { getLogger } from '@platform/observability';

const logger = getLogger('golden-key-api');
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3040);

async function main() {
  // mountApp reads config/apps/golden-key.json, mounts only declared cores,
  // and reports drift (declared-but-missing / present-but-undeclared).
  await mountApp(app, {
    appId: 'golden-key',
    configPath: 'config/apps/golden-key.json',
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, app: 'golden-key', version: '0.1.0' });
  });

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'Golden Key API listening');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Golden Key API failed to start');
  process.exit(1);
});
