import { encryptionService } from '../services/EncryptionService.js';

/**
 * Standardized API Response Utility
 * Handles encryption if sessionKey is present in res.locals
 */

export const successResponse = (res, data, message = 'Success', code = 200, options = {}) => {
    const payload = {
        success: true,
        message,
        data,
        meta: {
            timestamp: new Date().toISOString()
        }
    };

    return sendArgs(res, code, payload, options);
};

export const errorResponse = (res, message = 'Internal Server Error', code = 500, errors = null, options = {}) => {
    const payload = {
        success: false,
        message,
        meta: {
            timestamp: new Date().toISOString()
        }
    };

    if (errors) {
        payload.errors = errors;
    }

    return sendArgs(res, code, payload, options);
};

/**
 * Helper to Encrypt and Send
 */
const sendArgs = (res, code, payload, options) => {
    const sessionKey = options.key || res.locals?.sessionKey;
    const skipEncryption = options.encrypt === false;

    if (sessionKey && !skipEncryption) {
        try {
            const encrypted = encryptionService.encrypt(payload, sessionKey);
            return res.status(code).json({
                encrypted: true,
                payload: encrypted
            });
        } catch (e) {
            console.error('[ResponseUtil] Encryption Failed:', e);
            // Fallback to error response (recursive, but careful to avoid infinite loop by not passing key? 
            // Or just return plaintext error that encryption failed if we can't encrypt)
            return res.status(500).json({
                success: false,
                message: 'Response Encryption Failed',
                meta: { timestamp: new Date().toISOString() }
            });
        }
    }

    // Default: Plaintext (if no key or explicitly skipped)
    return res.status(code).json(payload);
};
