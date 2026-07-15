import { Router, Request, Response } from 'express';
import { createContact, addTag, mergeContacts, getContactLedger, AppError, isValidUuid } from '../../../../platform/contacts/src/index';

const router = Router();

function extractContext(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) throw new AppError('Missing x-tenant-id', 'BAD_REQUEST');
  return { tenantId, userId };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected contacts directory exception occurred.',
    code: code
  });
}

const paths = {
  create: ['/contacts', '/api/contacts/contacts'],
  tag: ['/contacts/:id/tags', '/api/contacts/contacts/:id/tags'],
  merge: ['/contacts/:id/merge', '/api/contacts/contacts/:id/merge'],
  ledger: ['/contacts/:id/ledger', '/api/contacts/contacts/:id/ledger']
};

router.post(paths.create, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await createContact(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.tag, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const contactId = req.params.id;
    if (!isValidUuid(contactId)) {
      throw new AppError(`Invalid Contact ID format: '${contactId}'`, 'BAD_REQUEST');
    }
    const result = await addTag(tenantId, contactId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.merge, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const targetId = req.params.id;
    if (!isValidUuid(targetId)) {
      throw new AppError(`Invalid Contact ID format: '${targetId}'`, 'BAD_REQUEST');
    }
    const result = await mergeContacts(tenantId, req.body.source_id, targetId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const contactId = req.params.id;
    if (!isValidUuid(contactId)) {
      throw new AppError(`Invalid Contact ID format: '${contactId}'`, 'BAD_REQUEST');
    }
    const result = await getContactLedger(tenantId, contactId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as contactsRouter, router as 'contactsRouter' };
