import { Router, Request, Response } from 'express';
import { enrollMember, createReward, awardPoints, redeemReward, ErrorCode } from '../../../../platform/loyalty/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  enroll: ['/enroll', '/api/loyalty/enroll'],
  createReward: ['/rewards', '/api/loyalty/rewards'],
  award: ['/members/:id/award', '/api/loyalty/members/:id/award'],
  redeem: ['/members/:id/redeem', '/api/loyalty/members/:id/redeem']
};

router.post(paths.enroll, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const member = await enrollMember(tenantId, req.body);
    res.status(201).json(member);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createReward, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const reward = await createReward(tenantId, req.body);
    res.status(201).json(reward);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.award, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const tx = await awardPoints(tenantId, req.params.id, req.body.points, req.body.description);
    res.status(201).json(tx);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.redeem, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const redemption = await redeemReward(tenantId, req.params.id, req.body.rewardId);
    res.status(201).json(redemption);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as loyaltyRouter };
