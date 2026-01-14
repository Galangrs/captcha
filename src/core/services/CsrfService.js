import { randomUUID } from 'crypto';

export const csrfService = {
    generate: () => {
        return randomUUID();
    },

    // In a stateless check where we compare against context, logic is simple equality.
    // But if we had signed tokens, verify would go here.
    verify: (providedToken, expectedToken) => {
        return providedToken && expectedToken && providedToken === expectedToken;
    }
};
