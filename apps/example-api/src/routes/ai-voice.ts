import { Router, Request, Response } from 'express';
import { transcribeAudio, generateSummary, processVoiceCommand, getVoiceLedger, AppError, isValidUuid } from '../../../../platform/ai-voice/src/index';

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
    error: msg || 'An unexpected AI voice intelligence exception occurred.',
    code: code
  });
}

const paths = {
  transcribe: ['/transcribe', '/api/ai-voice/transcribe'],
  summarize: ['/summarize', '/api/ai-voice/summarize'],
  command: ['/commands', '/api/ai-voice/commands'],
  ledger: ['/transcriptions/:id/ledger', '/api/ai-voice/transcriptions/:id/ledger']
};

router.post(paths.transcribe, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await transcribeAudio(tenantId, req.body);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.summarize, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    // Support both camelCase and snake_case inputs to ensure integration safety
    const targetId = req.body.transcriptionId || req.body.transcription_id;
    const result = await generateSummary(tenantId, targetId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.post(paths.command, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const result = await processVoiceCommand(tenantId, req.body, userId);
    res.status(201).json(result);
  } catch (error: any) { handleError(res, error); }
});

router.get(paths.ledger, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const transcriptionId = req.params.id;
    if (!isValidUuid(transcriptionId)) {
      throw new AppError(`Invalid Transcription ID format: '${transcriptionId}'`, 'BAD_REQUEST');
    }
    const result = await getVoiceLedger(tenantId, transcriptionId);
    res.status(200).json(result);
  } catch (error: any) { handleError(res, error); }
});

export { router as aiVoiceRouter, router as 'ai-voiceRouter' };
