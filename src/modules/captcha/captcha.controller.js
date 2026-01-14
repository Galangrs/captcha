import { successResponse, errorResponse } from '../../core/utils/response.util.js';
import { dynamicRouter } from '../../core/services/DynamicRouteService.js';
import { validate } from '../../core/middleware/validate.middleware.js';
import { captchaChallengeZod, captchaVerifyZod } from './captcha.schema.js';
import { encryptionService } from '../../core/services/EncryptionService.js';
import { encryptionMiddleware } from '../../core/middleware/encryption.middleware.js';
import { siteKeyService } from '../../core/services/SiteKeyService.js';
import { tokenStore } from '../../core/services/TokenStore.js';
import { challengeStore } from '../../core/services/ChallengeStore.js';
import { csrfService } from '../../core/services/CsrfService.js';
import { csrfMiddleware } from '../../core/middleware/csrf.middleware.js';

export const validateToken = async (req, res, next) => {
    try {
        const { token, siteKey, secret } = req.query; // Or Body

        // 1. Validate Secret
        if (!siteKeyService.validateSecret(siteKey, secret)) {
            return errorResponse(res, 'Invalid Secret Key', 403);
        }

        // 2. Consume Token
        const result = await tokenStore.consume(token);
        if (!result) {
            return errorResponse(res, 'Invalid or Expired Token', 400);
        }

        if (!result.valid) {
            return errorResponse(res, result.error, 409);
        }

        // 3. Return Data
        return successResponse(res, {
            valid: true,
            score: result.score,
            click: true, // "valid click"
            timestamp: new Date(result.timestamp).toISOString()
        });
    } catch (e) {
        next(e);
    }
};

export const initSession = async (req, res, next) => {
    try {
        let body = req.body;

        // 0. Decrypt Payload if present (Time-based Encryption)
        if (body.payload) {
            const currentKey = encryptionService.getTimeBasedKey(0);
            const prevKey = encryptionService.getTimeBasedKey(-1);
            const nextKey = encryptionService.getTimeBasedKey(1); // Tolerance

            let decrypted = null;
            const keys = [currentKey, prevKey, nextKey];

            for (const key of keys) {
                try {
                    decrypted = encryptionService.decrypt(body.payload, key);
                    if (decrypted && decrypted.siteKey) break;
                } catch (e) { /* Check next key */ }
            }

            if (!decrypted) {
                return errorResponse(res, 'Encryption Handshake Failed (Clock Skew?)', 400);
            }
            body = decrypted;
        } else {
            // Enforce Encryption
            return errorResponse(res, 'Unencrypted Init Not Allowed', 400);
        }

        const { siteKey, origin } = body;
        console.log('[InitSession] Request:', { siteKey, origin });

        // 1. Validate Site Key & Origin
        // Critical Fix: check request header if present to avoid spoofing (though headers can be spoofed by non-browsers, browsers force them)
        const reqOrigin = req.headers['origin'] || req.headers['referer'];
        if (reqOrigin) {
            try {
                const reqUrl = new URL(reqOrigin);
                const claimedUrl = new URL(origin);
                if (reqUrl.hostname !== claimedUrl.hostname) {
                    console.warn('[InitSession] Origin Mismatch:', reqUrl.hostname, 'vs', claimedUrl.hostname);
                    return errorResponse(res, 'Origin Mismatch', 403);
                }
            } catch (e) {
                // Ignore parsing errors for now, rely on SiteKeyService
            }
        }

        if (!siteKeyService.validate(siteKey, origin)) {
            console.error('[InitSession] Validation Failed for:', { siteKey, origin });
            return errorResponse(res, 'Invalid Site Key or Origin denied', 403);
        }

        // 1. Generate Random Paths & Session Key
        const challengePath = dynamicRouter.generatePath();
        const verifyPath = dynamicRouter.generatePath();
        const sessionKey = encryptionService.generateKey();
        const csrfToken = csrfService.generate();

        const context = { sessionKey, csrfToken };

        // 2. Register Routes dynamically with Encryption
        // POST /{challengePath}
        dynamicRouter.register(
            challengePath,
            'POST',
            requestChallenge,
            // Encryption -> CSRF -> Validation -> Controller
            [encryptionMiddleware, csrfMiddleware, validate({ body: captchaChallengeZod })],
            context
        );

        // POST /{verifyPath}
        dynamicRouter.register(
            verifyPath,
            'POST',
            verifyChallenge,
            // Encryption -> CSRF -> Validation -> Controller
            [encryptionMiddleware, csrfMiddleware, validate({ body: captchaVerifyZod })],
            context
        );

        // 3. Return paths & key to client
        return successResponse(res, {
            endpoints: {
                challenge: '/' + challengePath,
                verify: '/' + verifyPath
            },
            key: sessionKey, // The ONLY time this is sent plaintext
            csrfToken: csrfToken
        }, 'Session initialized');
    } catch (error) {
        next(error);
    }
};

export const requestChallenge = async (req, res, next) => {
    try {
        // Logic for generating captcha challenge would go here
        // Verify siteKey domain policy (TODO)

        const { siteKey, action, fingerprint, forceChallenge } = req.body;

        // --- Abuse Detection ---
        // Randomly trigger suspicion (10%) or if fingerprint looks bad (mock)
        const isSuspicious = forceChallenge || Math.random() < 0.1;

        let challengeType = 'smart-check';
        let payload = {};
        let requiredAns = null;

        if (isSuspicious) {
            challengeType = 'math';
            const a = Math.floor(Math.random() * 9) + 1;
            const b = Math.floor(Math.random() * 9) + 1;
            payload = { question: `${a} + ${b} = ?` };
            requiredAns = (a + b).toString();
        }

        const challengeId = (isSuspicious ? 'challenge-' : 'normal-') + fingerprint + '-' + Date.now();

        if (requiredAns) {
            challengeStore.set(challengeId, requiredAns);
        }

        const challengeData = {
            challengeId: challengeId,
            type: challengeType,
            payload: payload,
            issuedAt: new Date(),
            expiresIn: 120 // 2 minutes
        };

        return successResponse(res, challengeData, 'Challenge generated successfully');
    } catch (error) {
        next(error);
    }
};

export const verifyChallenge = async (req, res, next) => {
    try {
        const { sessionToken, mouseTrace = [], interactionType = 'mouse', answer } = req.body;

        console.log(`[Verify] Type: ${interactionType}, Trace: ${mouseTrace.length}`);

        // 0. Challenge Check (Math or Text)
        if (sessionToken.startsWith('challenge-')) {
            const requiredAns = challengeStore.get(sessionToken);

            if (!requiredAns) {
                return errorResponse(res, 'Challenge expired or invalid', 400);
            }

            // Case-insensitive comparison for text
            if (!answer || answer.toString().toLowerCase().trim() !== requiredAns.toString().toLowerCase().trim()) {
                return errorResponse(res, 'Incorrect Answer', 400);
            }

            // Cleanup
            challengeStore.delete(sessionToken);

            // SUCCESS! 
            // If they solved the math/text, we trust them enough. 
            // Skip strict mouse trace checks for this specific flow.
            const finalToken = await tokenStore.create(0.95, req.body.timeout);
            return successResponse(res, { token: finalToken }, 'Human verification passed');
        }

        // Logic based on interaction type
        // High Security Fix: Do not blindly trust 'interactionType'

        if (interactionType === 'keyboard') {
            // Validate keyboard usage properly or fallback to strict checks
            // valid keyboard usage is hard to distinguish from bots without other signals (e.g. key intervals)
            // For high security, we REQUIRE some signals or fail.
            // Mock: If no events, fail.
            return errorResponse(res, 'Bot detected: unexpected interaction type', 403);
        } else if (interactionType === 'touch') {
            // Touch users (Tap) have very short traces (1-2 points)
            if (!mouseTrace || mouseTrace.length < 1) {
                return errorResponse(res, 'Bot detected: No touch data', 403);
            }
        } else {
            // Default Mouse logic (Strict)
            // 1. Check length - Require at least 5 points for "Strict" mouse check to filter basic bots
            if (mouseTrace.length < 5) {
                return errorResponse(res, 'Bot detected: Insufficient cursor movement (Too few points)', 403);
            }

            // 2. Check time consistency (must not be 0ms duration)
            const startTime = mouseTrace[0].t;
            const endTime = mouseTrace[mouseTrace.length - 1].t;
            const duration = endTime - startTime;

            if (duration < 50) { // faster than 100ms for entire path is sus
                return errorResponse(res, 'Bot detected: Movement too fast', 403);
            }
        }

        // Calculate Score (Mock Logic)
        let score = 0.5;
        // if (interactionType === 'keyboard') score = 0.7; // Removed bypass
        if (interactionType === 'touch') score = 0.8;    // Harder to fake
        if (interactionType === 'mouse') score = 0.9;    // Passed strict checks

        // Generate One-Time Token with Score
        const finalToken = await tokenStore.create(score, req.body.timeout);

        return successResponse(res, { token: finalToken }, 'Human verification passed');
    } catch (error) {
        next(error);
    }
};
