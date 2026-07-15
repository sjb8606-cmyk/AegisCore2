import { Router, Request, Response } from 'express';
import { updateBrandConfig, getPublicBrandConfig, addCustomDomain, verifyCustomDomain, ErrorCode } from '../../../../platform/white-label/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  updateBrand: ['/branding', '/api/white-label/branding'],
  publicBrand: ['/branding/public', '/api/white-label/branding/public'],
  addDomain: ['/domains', '/api/white-label/domains'],
  verifyDomain: ['/domains/:id/verify', '/api/white-label/domains/:id/verify']
};

router.post(paths.updateBrand, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const brand = await updateBrandConfig(tenantId, userId, req.body);
    res.status(201).json(brand);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.publicBrand, async (req: Request, res: Response) => {
  try {
    const tenantId = req.header('x-tenant-id') || req.query.tenantId as string;
    if (!tenantId) throw { message: 'Missing tenantId', code: (ErrorCode as any).BAD_REQUEST };
    const brand = await getPublicBrandConfig(tenantId);
    res.status(200).json(brand);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.addDomain, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const domain = await addCustomDomain(tenantId, req.body.domain, userId);
    res.status(201).json(domain);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.verifyDomain, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await verifyCustomDomain(tenantId, req.params.id);
    res.status(200).json(result);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as whiteLabelRouter };
