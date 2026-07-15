import { Router } from 'express';
import { requireAuth } from '../../../../platform/auth/src/index';
import { tenantResolver } from '../../../../platform/tenancy/src/index';
import { AnnouncementsService } from '../../../../platform/announcements/src/index';
import { ok } from '../../../../platform/utils/src/index';

const router = Router();

router.post('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await AnnouncementsService.createAnnouncement(req.auth.tenantId, req.body, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/publish', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AnnouncementsService.publishAnnouncement(req.auth.tenantId, req.params.id);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/dismiss', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const userId = req.auth?.userId || req.auth?.sub || req.auth?.id || 'founder';
    const result = await AnnouncementsService.trackDismiss(req.auth.tenantId, req.params.id, userId);
    return ok(res, result);
  } catch (err) {
    next(err);
  }
});

router.get('/', requireAuth(), tenantResolver(), async (req: any, res: any, next: any) => {
  try {
    const result = await AnnouncementsService.fetchAnnouncements(req.auth.tenantId);
    return ok(res, { announcements: result });
  } catch (err) {
    next(err);
  }
});

export { router as announcementsRouter };
