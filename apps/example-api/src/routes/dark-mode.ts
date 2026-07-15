import { Router } from 'express';
import { darkModeRouter } from '../../../../platform/dark-mode/src/index';

const router = Router();
// Adding '/' catches the stripped route perfectly
router.use(['/', '/dark-mode', '/api/dark-mode'], darkModeRouter);

export { router as 'dark-modeRouter', router as darkModeRouter, router as default };
