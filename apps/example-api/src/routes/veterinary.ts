import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { registerAnimalPatient, addVaccinationRecord, createTreatmentPlan, getPatientTimeline, AppError, isValidUuid } from '../../../../platform/veterinary/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw new AppError('Missing authenticated context', 'UNAUTHORIZED');
  return { tenantId: auth.tenantId, userId: auth.sub };
}

function handleError(res: Response, error: any) {
  const msg = error instanceof Error ? error.message : (error?.message || String(error));
  const code = error?.code || 'INTERNAL_ERROR';
  const status = code === 'FORBIDDEN' ? 403 : (code === 'BAD_REQUEST' ? 400 : (code === 'NOT_FOUND' ? 404 : 500));
  
  res.status(status).json({ 
    error: msg || 'An unexpected clinical error occurred.',
    code: code
  });
}

const paths = {
  register: ['/patients', '/api/veterinary/patients'],
  vaccinate: ['/patients/:id/vaccinations', '/api/veterinary/patients/:id/vaccinations'],
  treat: ['/patients/:id/treatments', '/api/veterinary/patients/:id/treatments'],
  timeline: ['/patients/:id/timeline', '/api/veterinary/patients/:id/timeline']
};

router.post(paths.register, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await registerAnimalPatient(tenantId, userId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.vaccinate, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const patientId = req.params.id;
    if (!isValidUuid(patientId)) {
      throw new AppError(`Invalid Patient ID format: '${patientId}'`, 'BAD_REQUEST');
    }
    const result = await addVaccinationRecord(tenantId, patientId, req.body, userId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.treat, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const patientId = req.params.id;
    if (!isValidUuid(patientId)) {
      throw new AppError(`Invalid Patient ID format: '${patientId}'`, 'BAD_REQUEST');
    }
    const result = await createTreatmentPlan(tenantId, patientId, req.body, userId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.timeline, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const patientId = req.params.id;
    if (!isValidUuid(patientId)) {
      throw new AppError(`Invalid Patient ID format: '${patientId}'`, 'BAD_REQUEST');
    }
    const result = await getPatientTimeline(tenantId, patientId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as veterinaryRouter };
