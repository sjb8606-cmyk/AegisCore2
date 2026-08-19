/**
 * Explicit HTTP handlers for Golden Key.
 * Business logic lives in platform cores only.
 */

import { Router, Response, NextFunction } from 'express';
import {
  createVault,
  depositAsset,
  sealVault,
  sealAsset,
  getVault,
  getAsset,
  listAssets,
  AppError as VaultError,
} from '@platform/custody-vault';
import {
  issueAssetReceipt,
  issueVaultReceipt,
  verifyReceipt,
  getAuthorizedAssetView,
  AppError as ReceiptError,
} from '@platform/custody-receipt';
import type { AuthenticatedRequest } from '@platform/auth';

const router = Router();

function actor(req: AuthenticatedRequest): { tenantId: string; actorId: string } {
  const tenantId = req.auth?.tenantId;
  const actorId = req.auth?.sub;
  if (!tenantId || !actorId) {
    throw new VaultError('Unauthorized', 'UNAUTHORIZED' as any);
  }
  return { tenantId, actorId };
}

// ── Vaults ───────────────────────────────────────────────────

router.post('/vaults', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    const result = await createVault(tenantId, actorId, {
      name: req.body?.name,
      description: req.body?.description,
      policy: req.body?.policy,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/vaults/:vaultId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = actor(req);
    const vault = await getVault(tenantId, req.params.vaultId);
    if (!vault) return res.status(404).json({ error: 'NOT_FOUND', message: 'Vault not found' });
    res.json({ vault });
  } catch (err) {
    next(err);
  }
});

router.post('/vaults/:vaultId/assets', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    const result = await depositAsset(tenantId, actorId, {
      vaultId: req.params.vaultId,
      name: req.body?.name,
      contentType: req.body?.contentType,
      byteSize: req.body?.byteSize,
      contentHash: req.body?.contentHash,
      encryptedEnvelope: req.body?.encryptedEnvelope,
      storageKey: req.body?.storageKey,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/vaults/:vaultId/assets', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = actor(req);
    const assets = await listAssets(tenantId, req.params.vaultId);
    res.json({ assets });
  } catch (err) {
    next(err);
  }
});

router.post('/vaults/:vaultId/seal', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    const result = await sealVault(tenantId, actorId, req.params.vaultId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/vaults/:vaultId/receipt', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    const receipt = await issueVaultReceipt(tenantId, actorId, req.params.vaultId);
    res.status(201).json({ receipt });
  } catch (err) {
    next(err);
  }
});

// ── Assets ───────────────────────────────────────────────────

router.get('/assets/:assetId', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    // Prefer authorized view (includes storage pointer + envelope metadata)
    const view = await getAuthorizedAssetView(tenantId, actorId, req.params.assetId);
    res.json({ asset: view });
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:assetId/seal', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    const result = await sealAsset(tenantId, actorId, req.params.assetId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:assetId/receipt', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId, actorId } = actor(req);
    const receipt = await issueAssetReceipt(tenantId, actorId, req.params.assetId);
    res.status(201).json({ receipt });
  } catch (err) {
    next(err);
  }
});

// ── Receipts ─────────────────────────────────────────────────

router.post('/receipts/verify', async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { tenantId } = actor(req);
    const receipt = req.body?.receipt;
    if (!receipt) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'receipt is required' });
    }
    const result = await verifyReceipt(tenantId, receipt, {
      verifyChain: req.body?.verifyChain !== false,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
