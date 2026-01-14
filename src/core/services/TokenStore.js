import crypto from 'crypto';
import Redis from 'ioredis';
import dotenv from 'dotenv';
dotenv.config();

import { Redis as UpstashRedis } from '@upstash/redis';

class TokenStore {
    constructor() {
        this.clientType = 'memory'; // 'ioredis' | 'upstash' | 'memory'
        this.client = null;

        // 1. Check for Upstash (HTTP/REST)
        if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
            console.log('[TokenStore] Initializing Upstash Redis (HTTP)...');
            try {
                this.client = new UpstashRedis({
                    url: process.env.UPSTASH_REDIS_REST_URL,
                    token: process.env.UPSTASH_REDIS_REST_TOKEN,
                });
                this.clientType = 'upstash';
                console.log('[TokenStore] Upstash Client Configured');
            } catch (e) {
                console.error('[TokenStore] Upstash Init Error:', e.message);
            }
        }
        // 2. Check for Standard Redis (ioredis)
        else if (process.env.REDIS_HOST) {
            console.log('[TokenStore] Initializing Standard Redis (ioredis)...');
            this.client = new Redis({
                host: process.env.REDIS_HOST,
                port: process.env.REDIS_PORT || 6379,
                username: process.env.REDIS_USER,
                password: process.env.REDIS_PASS,
                lazyConnect: true,
                retryStrategy: (times) => Math.min(times * 50, 2000)
            });

            this.client.connect().then(() => {
                console.log('[TokenStore] ioredis Connected');
                this.clientType = 'ioredis';
            }).catch(err => {
                console.error('[TokenStore] ioredis Connection Failed:', err.message);
                this.client = null;
                this.clientType = 'memory';
            });

            this.client.on('error', (err) => {
                console.error('[TokenStore] ioredis Error:', err.message);
                // If error occurs, we might stay in ioredis mode hoping it reconnects,
                // or switch to memory strictly? For now, we rely on retryStrategy.
            });
        }

        if (this.clientType === 'memory') {
            console.log('[TokenStore] Using In-Memory Store.');
        }

        // Fallback Store
        // Map<token, { score: number, createdAt: number, used: boolean }>
        this.tokens = new Map();

        // Cleanup in-memory every 10 minutes
        setInterval(() => this.cleanup(), 10 * 60 * 1000);
    }

    /**
     * Create a new OTP token with a score
     * @param {number} score 0.0 to 1.0
     * @param {number} timeoutMs Validation timeout in ms (default 120000)
     * @returns {Promise<string>} token
     */
    async create(score, timeoutMs = 120000) {
        const token = crypto.randomUUID();
        // Enforce harsh cap of 2 minutes (120s)
        const effectiveTimeout = Math.min(timeoutMs, 120 * 1000);
        const ttlSeconds = Math.ceil(effectiveTimeout / 1000);

        const dataObj = {
            score,
            createdAt: Date.now()
        };

        try {
            if (this.clientType === 'upstash') {
                // Upstash: set(key, value, { ex: seconds })
                // It auto-serializes objects usually, but let's be safe and stringify if needed.
                // Upstash SDK handles objects fine? It returns them as objects in get().
                // Let's use JSON stringify for consistency across stores.
                await this.client.set(token, JSON.stringify(dataObj), { ex: ttlSeconds });
                return token;
            }

            if (this.clientType === 'ioredis' && this.client && this.client.status === 'ready') {
                await this.client.set(token, JSON.stringify(dataObj), 'EX', ttlSeconds);
                return token;
            }
        } catch (e) {
            console.error('[TokenStore] Redis Set Error, falling back to memory', e);
        }

        // In-Memory Fallback
        this.tokens.set(token, {
            score,
            createdAt: Date.now(),
            expiresAt: Date.now() + effectiveTimeout,
            used: false
        });
        return token;
    }

    /**
     * Consume a token (check validity + mark as used/delete)
     * @param {string} token 
     * @returns {Promise<object|null>} { score, valid: true } or null
     */
    async consume(token) {
        try {
            if (this.clientType === 'upstash') {
                // Upstash HTTP: get(key) -> returns null or data
                // To be strictly single use:
                // We can use a script or get-then-del.
                // Upstash SDK has .del()
                const dataStr = await this.client.get(token);
                if (!dataStr) return null;

                await this.client.del(token);

                // Upstash SDK might check content-type and return object if it was JSON? 
                // We stored it as JSON string manually above.
                // If Upstash SDK auto-parsed it, dataStr is object.
                let data = dataStr;
                if (typeof dataStr === 'string') {
                    try { data = JSON.parse(dataStr); } catch (e) { }
                }

                return { valid: true, score: data.score, timestamp: data.createdAt };
            }

            if (this.clientType === 'ioredis' && this.client && this.client.status === 'ready') {
                const dataStr = await this.client.get(token);
                if (!dataStr) return null;

                await this.client.del(token);

                const data = JSON.parse(dataStr);
                return { valid: true, score: data.score, timestamp: data.createdAt };
            }
        } catch (e) {
            console.error('[TokenStore] Redis Consume Error', e);
        }

        // 2. Try In-Memory
        if (!this.tokens.has(token)) return null;

        const data = this.tokens.get(token);

        // Check Expiry (Custom or Default)
        if (Date.now() > (data.expiresAt || (data.createdAt + 2 * 60 * 1000))) {
            this.tokens.delete(token); // Cleanup
            return null;
        }

        // Check if previously used (In-memory flag)
        if (data.used) {
            return { valid: false, error: 'Token already used' };
        }

        // Mark as used & Delete (Single Use)
        data.used = true;
        this.tokens.delete(token);

        return { valid: true, score: data.score, timestamp: data.createdAt };
    }

    cleanup() {
        const now = Date.now();
        for (const [token, data] of this.tokens.entries()) {
            if (now > (data.expiresAt || (data.createdAt + 10 * 60 * 1000))) {
                this.tokens.delete(token);
            }
        }
    }
}

export const tokenStore = new TokenStore();
