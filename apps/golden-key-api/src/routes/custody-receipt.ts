/**
 * apps/golden-key-api/src/routes/custody-receipt.ts
 * Split out of the old single custody.ts, matching the "custody-receipt"
 * core declared in config/apps/golden-key.json.
 */

import { Router } from 'express';
import {
  issueAssetReceipt,
  issueVaultReceipt,
  verifyReceipt,
  getAuthorizedAssetView,
} from '@platform/custody-receipt';

const router = Router();

function tenantId(req: any): string {
  const id = req.auth?.tenantId || req.tenantId;
  if (!id) {
    const err: any = new Error('Unauthorized: missing tenant');
    err.status = 401;
    throw err;
  }
  return id;
}

function actorId(req: any): string {
  const id = req.auth?.sub;
  if (!id) {
    const err: any = new Error('Unauthorized: missing actor');
    err.status = 401;
    throw err;
  }
  return id;
}

router.post('/vaults/:vaultId/receipt', async (req: any, res, next) => {
  try {
    const receipt = await issueVaultReceipt(
      tenantId(req),
      actorId(req),
      req.params.vaultId,
    );
    res.status(201).json({ receipt });
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:assetId/receipt', async (req: any, res, next) => {
  try {
    const receipt = await issueAssetReceipt(
      tenantId(req),
      actorId(req),
      req.params.assetId,
    );
    res.status(201).json({ receipt });
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:assetId/view', async (req: any, res, next) => {
  try {
    const view = await getAuthorizedAssetView(
      tenantId(req),
      actorId(req),
      req.params.assetId,
    );
    res.json({ asset: view });
  } catch (err) {
    next(err);
  }
});

router.post('/verify', async (req: any, res, next) => {
  try {
    if (!req.body?.receipt) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'receipt is required' });
    }
    const result = await verifyReceipt(tenantId(req), req.body.receipt, {
      verifyChain: req.body?.verifyChain !== false,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
