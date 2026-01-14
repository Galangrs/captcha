import { Router } from 'express';
import * as captchaController from './captcha.controller.js';
import { validate } from '../../core/middleware/validate.middleware.js';
import { captchaChallengeZod, captchaVerifyZod } from './captcha.schema.js';

const router = Router();

// POST /api/v1/captcha/init
// This is the ONLY static entry point.
router.post(
    '/init',
    //  validate({ body: captchaChallengeZod }), // Optional: Validate siteKey if needed here
    captchaController.initSession
);

// New: Server-side Token Validation
router.get('/validate', captchaController.validateToken);

// DYNAMIC ROUTES - Handled by root middleware now
// router.post('/challenge', ... );
// router.post('/verify', ... );

export default router;
