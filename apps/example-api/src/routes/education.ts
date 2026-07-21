import { Router, Request, Response } from 'express';
import { AuthenticatedRequest } from '../../../../platform/auth/src/index';

import { createCourse, createLesson, enrollStudent, completeLesson, generateCertificate, ErrorCode } from '../../../../platform/education/src/index';

const router = Router();

function extractContext(req: Request) {
  const auth = (req as AuthenticatedRequest).auth;
  if (!auth) throw { message: 'Missing authenticated context', code: (ErrorCode as any).UNAUTHORIZED };
  return { tenantId: auth.tenantId, userId: auth.sub };
}

const paths = {
  createCourse: ['/courses', '/api/education/courses'],
  createLesson: ['/courses/:courseId/lessons', '/api/education/courses/:courseId/lessons'],
  enroll: ['/courses/:courseId/enroll', '/api/education/courses/:courseId/enroll'],
  complete: ['/enrollments/:enrollId/lessons/:lessonId/complete', '/api/education/enrollments/:enrollId/lessons/:lessonId/complete'],
  cert: ['/enrollments/:enrollId/certificate', '/api/education/enrollments/:enrollId/certificate']
};

router.post(paths.createCourse, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const course = await createCourse(tenantId, userId, req.body);
    res.status(201).json(course);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.createLesson, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const lesson = await createLesson(tenantId, req.params.courseId, req.body);
    res.status(201).json(lesson);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.enroll, async (req: Request, res: Response) => {
  try {
    const { tenantId, userId } = extractContext(req);
    const enrollment = await enrollStudent(tenantId, req.params.courseId, userId);
    res.status(201).json(enrollment);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

router.post(paths.complete, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const result = await completeLesson(tenantId, req.params.enrollId, req.params.lessonId);
    res.status(200).json(result);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

router.get(paths.cert, async (req: Request, res: Response) => {
  try {
    const { tenantId } = extractContext(req);
    const pdf = await generateCertificate(tenantId, req.params.enrollId);
    res.setHeader('Content-Type', 'application/pdf');
    res.send(pdf);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

export { router as educationRouter };
