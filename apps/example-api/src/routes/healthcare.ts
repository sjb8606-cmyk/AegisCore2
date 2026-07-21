import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createPatient, getPatient, createNote, signNote, recordConsent, ErrorCode } from '../../../../platform/healthcare/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createPatient: ['/patients', '/api/healthcare/patients'],
  getPatient: ['/patients/:id', '/api/healthcare/patients/:id'],
  createNote: ['/patients/:id/notes', '/api/healthcare/patients/:id/notes'],
  signNote: ['/notes/:id/sign', '/api/healthcare/notes/:id/sign'],
  consent: ['/patients/:id/consent', '/api/healthcare/patients/:id/consent']
};

router.post(paths.createPatient, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const patient = await createPatient(tenantId, req.body, userId);
    res.status(201).json(patient);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.get(paths.getPatient, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const patient = await getPatient(tenantId, req.params.id);
    res.status(200).json(patient);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.createNote, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const note = await createNote(tenantId, req.params.id, req.body, userId);
    res.status(201).json(note);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

router.post(paths.signNote, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await signNote(tenantId, req.params.id, userId);
    res.status(200).json(result);
  } catch (error: any) { res.status(404).json({ error: error.message }); }
});

router.post(paths.consent, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const consent = await recordConsent(tenantId, req.params.id, req.body);
    res.status(201).json(consent);
  } catch (error: any) { res.status(400).json({ error: error.message }); }
});

export { router as healthcareRouter };
