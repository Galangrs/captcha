import { errorResponse } from '../utils/response.util.js';
import { csrfService } from '../services/CsrfService.js';

export const csrfMiddleware = (req, res, next) => {
    // Expecting token in headers
    const providedToken = req.headers['x-csrf-token'];

    // Retrieve expected token from dynamic context (set during initSession)
    const expectedToken = req.dynamicContext ? req.dynamicContext.csrfToken : null;

    if (!expectedToken) {
        // If no expected token is in context, it means this route wasn't protected by initSession properly
        // or the context was lost.
        console.warn('[CSRF] No expected token found in context');
        return errorResponse(res, 'CSRF Configuration Error', 500);
    }

    if (!providedToken) {
        return errorResponse(res, 'Missing CSRF Token', 403);
    }

    if (!csrfService.verify(providedToken, expectedToken)) {
        return errorResponse(res, 'Invalid CSRF Token', 403);
    }

    next();
};
