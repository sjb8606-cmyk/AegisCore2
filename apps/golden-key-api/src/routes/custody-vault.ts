import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import {
  createVault,
  depositAsset,
  sealVault,
  sealAsset,
  getVault,
  getAsset,
  listAssets,
} from '../../../../platform/custody-vault/src/index';

const router = Router();

router.post('/vaults', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await createVault(tenantId, req.auth.sub, {
      name: req.body?.name,
      description: req.body?.description,
      policy: req.body?.policy,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/vaults/:vaultId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const vault = await getVault(tenantId, req.params.vaultId);
    if (!vault) return res.status(404).json({ error: 'NOT_FOUND', message: 'Vault not found' });
    res.json({ vault });
  } catch (err) { next(err); }
});

router.post('/vaults/:vaultId/assets', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await depositAsset(tenantId, req.auth.sub, {
      vaultId: req.params.vaultId,
      name: req.body?.name,
      contentType: req.body?.contentType,
      byteSize: req.body?.byteSize,
      contentHash: req.body?.contentHash,
      encryptedEnvelope: req.body?.encryptedEnvelope,
      storageKey: req.body?.storageKey,
    });
    res.status(201).json(result);
  } catch (err) { next(err); }
});

router.get('/vaults/:vaultId/assets', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const assets = await listAssets(tenantId, req.params.vaultId);
    res.json({ assets });
  } catch (err) { next(err); }
});

router.post('/vaults/:vaultId/seal', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await sealVault(tenantId, req.auth.sub, req.params.vaultId);
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/assets/:assetId', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const asset = await getAsset(tenantId, req.params.assetId);
    if (!asset) return res.status(404).json({ error: 'NOT_FOUND', message: 'Asset not found' });
    res.json({ asset });
  } catch (err) { next(err); }
});

router.post('/assets/:assetId/seal', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const result = await sealAsset(tenantId, req.auth.sub, req.params.assetId);
    res.json(result);
  } catch (err) { next(err); }
});

export default router;
