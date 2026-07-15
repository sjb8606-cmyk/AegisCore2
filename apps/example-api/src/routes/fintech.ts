import { Router, Request, Response } from 'express';
import { createAccount, createJournalEntry, voidJournalEntry, getLedgerAccount, ErrorCode } from '../../../../platform/fintech/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw { message: 'Missing x-tenant-id', code: (ErrorCode as any).BAD_REQUEST };
  return { tenantId, userId };
}

const paths = {
  createAccount: ['/accounts', '/api/fintech/accounts'],
  getAccount: ['/accounts/:id', '/api/fintech/accounts/:id'],
  createEntry: ['/entries', '/api/fintech/entries'],
  voidEntry: ['/entries/:id/void', '/api/fintech/entries/:id/void']
};

router.post(paths.createAccount, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const account = await createAccount(tenantId, req.body);
    res.status(201).json(account);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getAccount, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const account = await getLedgerAccount(tenantId, req.params.id);
    res.status(200).json(account);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.createEntry, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const entry = await createJournalEntry(tenantId, userId, req.body);
    res.status(201).json(entry);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.voidEntry, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const reversal = await voidJournalEntry(tenantId, req.params.id, req.body.reason, userId);
    res.status(201).json(reversal);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as fintechRouter };
