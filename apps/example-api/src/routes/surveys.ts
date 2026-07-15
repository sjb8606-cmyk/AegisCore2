import { Router, Request, Response } from 'express';
import { 
  createSurvey, 
  submitSurveyResponse, 
  calculateNpsScore, 
  ErrorCode 
} from '../../../../platform/surveys/src/index';

const router = Router();

function extractTenantAndUser(req: Request) {
  const tenantId = req.header('x-tenant-id');
  const userId = req.header('x-user-id') || 'founder';
  if (!tenantId) {
    throw { message: 'Missing x-tenant-id header required for operation', code: (ErrorCode as any).BAD_REQUEST };
  }
  return { tenantId, userId };
}

const paths = {
  createSurvey: ['/', '/surveys', '/api/surveys'],
  submitResponse: ['/:surveyId/responses', '/surveys/:surveyId/responses', '/api/surveys/:surveyId/responses'],
  getNps: ['/:surveyId/nps', '/surveys/:surveyId/nps', '/api/surveys/:surveyId/nps']
};

router.post(paths.createSurvey, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractTenantAndUser(req);
    const survey = await createSurvey(tenantId, userId, req.body);
    res.status(201).json(survey);
  } catch (error: any) {
    const statusCode = error.code === (ErrorCode as any).FORBIDDEN ? 403 : 
                       error.code === (ErrorCode as any).INSUFFICIENT_STORAGE ? 507 : 400;
    res.status(statusCode).json({ error: error.message || 'Internal database error' });
  }
});

router.post(paths.submitResponse, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractTenantAndUser(req);
    const { surveyId } = req.params;
    const meta = {
      ip: req.ip,
      userAgent: req.get('user-agent')
    };
    const response = await submitSurveyResponse(tenantId, surveyId, req.body, meta);
    res.status(201).json(response);
  } catch (error: any) {
    const statusCode = error.code === (ErrorCode as any).NOT_FOUND ? 404 : 400;
    res.status(statusCode).json({ error: error.message || 'Internal response failure' });
  }
});

router.get(paths.getNps, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractTenantAndUser(req);
    const { surveyId } = req.params;
    const nps = await calculateNpsScore(tenantId, surveyId);
    res.status(200).json(nps);
  } catch (error: any) {
    const statusCode = error.code === (ErrorCode as any).FORBIDDEN ? 403 : 500;
    res.status(statusCode).json({ error: error.message || 'NPS calculation error' });
  }
});

export { router as surveysRouter };
