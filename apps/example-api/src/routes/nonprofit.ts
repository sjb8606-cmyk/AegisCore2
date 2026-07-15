import { Router, Request, Response } from 'express';
import { createDonor, createCampaign, getCampaign, recordDonation, generateTaxReceipt, ErrorCode } from '../../../../platform/nonprofit/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId };
}

const paths = {
  createDonor: ['/donors', '/api/nonprofit/donors'],
  createCampaign: ['/campaigns', '/api/nonprofit/campaigns'],
  getCampaign: ['/campaigns/:id', '/api/nonprofit/campaigns/:id'],
  donate: ['/donate', '/api/nonprofit/donate'],
  receipt: ['/donations/:id/receipt', '/api/nonprofit/donations/:id/receipt']
};

router.post(paths.createDonor, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const donor = await createDonor(tenantId, req.body);
    res.status(201).json(donor);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.createCampaign, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const campaign = await createCampaign(tenantId, req.body);
    res.status(201).json(campaign);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getCampaign, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const campaign = await getCampaign(tenantId, req.params.id);
    res.status(200).json(campaign);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.donate, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const donation = await recordDonation(tenantId, req.body);
    res.status(201).json(donation);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.receipt, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const pdf = await generateTaxReceipt(tenantId, req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as nonprofitRouter };
