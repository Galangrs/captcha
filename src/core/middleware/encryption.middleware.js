import { encryptionService } from '../services/EncryptionService.js';

export const encryptionMiddleware = (req, res, next) => {
    const sessionKey = req.dynamicContext?.sessionKey;

    // Only apply if session key is present (dynamic routes)
    if (!sessionKey) return next();

    console.log('[EncryptionMiddleware] Active for:', req.path);

    // 1. Decrypt Incoming Request
    if (req.method === 'POST' || req.method === 'PUT') {
        try {
            if (!req.body.payload) {
                return next(new Error('Missing encrypted payload'));
            }

            const decryptedBody = encryptionService.decrypt(req.body.payload, sessionKey);
            console.log('[EncryptionMiddleware] Decrypted Body:', JSON.stringify(decryptedBody));
            req.body = decryptedBody;
        } catch (err) {
            console.error('[EncryptionMiddleware] Decryption Failed:', err);
            return next(new Error('Invalid encrypted payload'));
        }
    }

    // 2. Set Session Key for Response Utility to use
    if (sessionKey) {
        res.locals.sessionKey = sessionKey;
    }

    next();
};
