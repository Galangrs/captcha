import { Router } from 'express';
import { registerModules } from '../core/router/registerModules.js';

const router = Router();

// Register all API modules
registerModules(router);

// Health Check
router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date() });
});

export default router;
