import crypto from 'crypto';

class SiteKeyService {
    constructor() {
        // Map<key, { name: string, domains: string[], active: boolean, privateKey: string }>
        this.keys = new Map();

        // Seed Default Demo Key
        this.keys.set('1234567890', {
            name: 'Demo App',
            domains: ['localhost', '127.0.0.1'], // Allowed hostnames
            active: true,
            privateKey: 'demo-private-key'
        });
    }

    /**
     * Validate a site key against an origin
     * @param {string} key 
     * @param {string} originUrl 
     * @returns {boolean}
     */
    validate(key, originUrl) {
        console.log(`[SiteKeyService] Validating Key: ${key} Origin: ${originUrl}`);
        if (!key) return false;

        const keyData = this.keys.get(key);
        if (!keyData) {
            console.log('[SiteKeyService] Key not found');
            return false;
        }
        if (!keyData.active) {
            console.log('[SiteKeyService] Key inactive');
            return false;
        }

        // Origin Check
        try {
            const url = new URL(originUrl);
            console.log('[SiteKeyService] Parsed Protocol:', url.protocol, 'Hostname:', url.hostname);

            // 1. Check Protocol
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                console.log('[SiteKeyService] Protocol not allowed:', url.protocol);
                return false;
            }

            // 2. Check Hostname
            const hostname = url.hostname;
            const allowed = keyData.domains.includes(hostname);
            if (!allowed) console.log(`[SiteKeyService] Hostname ${hostname} not in ${keyData.domains}`);
            return allowed;
        } catch (e) {
            console.error('[SiteKeyService] Invalid Origin URL:', originUrl, e);
            return false;
        }
    }

    /**
     * Validate a Key Pair (Public + Private)
     */
    validateSecret(siteKey, privateKey) {
        const keyData = this.keys.get(siteKey);
        if (!keyData) return false;
        return keyData.privateKey === privateKey;
    }

    /**
     * Generate a new Site Key Pair
     */
    generate(name, domains = []) {
        // Generate random keys
        const newKey = crypto.randomBytes(10).toString('hex');
        const newSecret = 'sk_' + crypto.randomBytes(16).toString('hex');

        this.keys.set(newKey, {
            name,
            domains,
            active: true,
            privateKey: newSecret
        });

        console.log(`[SiteKeyService] Generated for ${name} -> Public: ${newKey}, Secret: ${newSecret}`);
        return { siteKey: newKey, privateKey: newSecret };
    }
}

export const siteKeyService = new SiteKeyService();
