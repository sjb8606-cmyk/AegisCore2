import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createProperty, bookShowing, createOffer, acceptOffer, geoSearchProperties, ErrorCode } from '../../../../platform/realestate/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createProperty: ['/properties', '/api/realestate/properties'],
  bookShowing: ['/properties/:id/showings', '/api/realestate/properties/:id/showings'],
  createOffer: ['/properties/:id/offers', '/api/realestate/properties/:id/offers'],
  acceptOffer: ['/offers/:coid/accept', '/api/realestate/offers/:coid/accept'],
  geoSearch: ['/search/geo', '/api/realestate/search/geo']
};

router.post(paths.createProperty, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const prop = await createProperty(tenantId, userId, req.body);
    res.status(201).json(prop);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.bookShowing, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const showing = await bookShowing(tenantId, req.params.id, req.body);
    res.status(201).json(showing);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createOffer, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const offer = await createOffer(tenantId, req.params.id, req.body);
    res.status(201).json(offer);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.acceptOffer, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const tx = await acceptOffer(tenantId, req.params.coid);
    res.status(200).json(tx);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.geoSearch, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const lat = parseFloat(req.query.lat as string) || 0.0;
    const lon = parseFloat(req.query.lon as string) || 0.0;
    const radius = parseFloat(req.query.radius as string) || 10.0;
    const results = await geoSearchProperties(tenantId, lat, lon, radius);
    res.status(200).json(results);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as realestateRouter };
