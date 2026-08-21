/**
 * Golden Key HTTP routes — thin adapters only.
 * Business logic lives in platform cores.
 */

import { Router } from 'express';
import {
  createVault,
  getVault,
  listAssets,
  sealVault,
  sealAsset,
  getAsset,
} from '@platform/custody-vault';
import { releaseVault, releaseAsset } from '@platform/custody-vault/src/release';
import { destroyVault, destroyAsset } from '@platform/custody-vault/src/destroy';
import {
  issueAssetReceipt,
  issueVaultReceipt,
  verifyReceipt,
  getAuthorizedAssetView,
} from '@platform/custody-receipt';
import { depositSecure, retrieveSecure } from '@platform/custody-ops';

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

// ── Vaults ───────────────────────────────────────────────────

router.post('/vaults', async (req: any, res, next) => {
  try {
    const result = await createVault(tenantId(req), actorId(req), {
      name: req.body?.name,
      description: req.body?.description,
      policy: req.body?.policy,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/vaults/:vaultId', async (req: any, res, next) => {
  try {
    const vault = await getVault(tenantId(req), req.params.vaultId);
    if (!vault) return res.status(404).json({ error: 'NOT_FOUND', message: 'Vault not found' });
    res.json({ vault });
  } catch (err) {
    next(err);
  }
});

router.post('/vaults/:vaultId/seal', async (req: any, res, next) => {
  try {
    const result = await sealVault(tenantId(req), actorId(req), req.params.vaultId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/vaults/:vaultId/release', async (req: any, res, next) => {
  try {
    const result = await releaseVault(
      tenantId(req),
      actorId(req),
      req.params.vaultId,
      req.body?.reason,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/vaults/:vaultId/destroy', async (req: any, res, next) => {
  try {
    const result = await destroyVault(
      tenantId(req),
      actorId(req),
      req.params.vaultId,
      req.body?.reason,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

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

router.get('/vaults/:vaultId/assets', async (req: any, res, next) => {
  try {
    const assets = await listAssets(tenantId(req), req.params.vaultId);
    res.json({ assets });
  } catch (err) {
    next(err);
  }
});

// ── Secure deposit / retrieve (orchestration) ────────────────

router.post('/vaults/:vaultId/deposit', async (req: any, res, next) => {
  try {
    // Body: { name, contentType?, plaintextBase64 } or { name, contentType?, plaintext }
    let plaintext: Buffer;
    if (req.body?.plaintextBase64) {
      plaintext = Buffer.from(req.body.plaintextBase64, 'base64');
    } else if (typeof req.body?.plaintext === 'string') {
      plaintext = Buffer.from(req.body.plaintext, 'utf8');
    } else {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'plaintext or plaintextBase64 is required',
      });
    }

    const result = await depositSecure(tenantId(req), actorId(req), {
      vaultId: req.params.vaultId,
      name: req.body?.name || 'asset',
      contentType: req.body?.contentType,
      plaintext,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/assets/:assetId/retrieve', async (req: any, res, next) => {
  try {
    const result = await retrieveSecure(
      tenantId(req),
      actorId(req),
      req.params.assetId,
    );
    res.json({
      assetId: result.assetId,
      name: result.name,
      contentType: result.contentType,
      contentHash: result.contentHash,
      plaintextBase64: result.plaintext.toString('base64'),
    });
  } catch (err) {
    next(err);
  }
});

// ── Assets ───────────────────────────────────────────────────

router.get('/assets/:assetId', async (req: any, res, next) => {
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

router.post('/assets/:assetId/seal', async (req: any, res, next) => {
  try {
    const result = await sealAsset(tenantId(req), actorId(req), req.params.assetId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:assetId/release', async (req: any, res, next) => {
  try {
    const result = await releaseAsset(
      tenantId(req),
      actorId(req),
      req.params.assetId,
      req.body?.reason,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/assets/:assetId/destroy', async (req: any, res, next) => {
  try {
    const result = await destroyAsset(
      tenantId(req),
      actorId(req),
      req.params.assetId,
      req.body?.reason,
    );
    res.json(result);
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

// ── Receipts ─────────────────────────────────────────────────

router.post('/receipts/verify', async (req: any, res, next) => {
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
