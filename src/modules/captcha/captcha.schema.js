import { z } from 'zod';
import Joi from 'joi';

// Zod Schema for Client Input (Body) - Request from Browser
export const captchaChallengeZod = z.object({
    siteKey: z.string().min(10, "Site Key must be at least 10 chars"),
    action: z.string().min(1, "Action is required"),
    fingerprint: z.string().min(16, "Fingerprint invalid"),
    data: z.record(z.any()).optional() // Dynamic data payload
});

// Joi Schema for Server-Side Checks (e.g. strict params/headers/internal)
// Example: Validating an internal ID param
export const captchaIdParamJoi = Joi.object({
    id: Joi.string().uuid().required()
});

// Zod Schema for Verification
export const captchaVerifyZod = z.object({
    sessionToken: z.string().min(5),
    interactionType: z.enum(['mouse', 'touch', 'keyboard']).optional().default('mouse'),
    mouseTrace: z.array(z.object({
        x: z.number(),
        y: z.number(),
        t: z.number()
    })).optional(), // Relaxed for server-side logic to handle
    answer: z.string().optional(), // For Math/Text challenges
    timeout: z.number().int().positive().optional() // User requested timeout in ms
});
