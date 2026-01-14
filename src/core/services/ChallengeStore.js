class ChallengeStore {
    constructor() {
        // Map<sessionToken, { requiredAns: string, createdAt: number }>
        this.challenges = new Map();

        // Cleanup interval (1 minute)
        setInterval(() => this.cleanup(), 60 * 1000);
    }

    /**
     * Store a new challenge
     * @param {string} token 
     * @param {string} answer 
     */
    set(token, answer) {
        this.challenges.set(token, {
            requiredAns: answer,
            createdAt: Date.now()
        });
    }

    /**
     * Get a challenge by token
     * @param {string} token 
     * @returns {string|null} answer
     */
    get(token) {
        const data = this.challenges.get(token);
        if (!data) return null;
        return data.requiredAns;
    }

    /**
     * Delete a challenge
     * @param {string} token 
     */
    delete(token) {
        this.challenges.delete(token);
    }

    cleanup() {
        const now = Date.now();
        for (const [token, data] of this.challenges.entries()) {
            // Expire after 5 minutes
            if (now - data.createdAt > 5 * 60 * 1000) {
                this.challenges.delete(token);
            }
        }
    }
}

export const challengeStore = new ChallengeStore();
