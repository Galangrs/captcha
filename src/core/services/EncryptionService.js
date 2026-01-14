import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended for GCM

export const encryptionService = {
    /**
     * Generate a random 256-bit key
     */
    generateKey: () => {
        return crypto.randomBytes(32).toString('hex');
    },

    /**
     * Encrypt JSON object ot string
     */
    encrypt: (data, keyHex) => {
        const text = JSON.stringify(data);
        const iv = crypto.randomBytes(IV_LENGTH);
        const key = Buffer.from(keyHex, 'hex');

        const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        const authTag = cipher.getAuthTag().toString('hex');

        // Format: iv:encrypted:authTag
        return `${iv.toString('hex')}:${encrypted}:${authTag}`;
    },

    /**
     * Decrypt string to JSON object
     */
    decrypt: (encryptedString, keyHex) => {
        const parts = encryptedString.split(':');
        if (parts.length !== 3) throw new Error('Invalid encrypted format');

        const [ivHex, contentHex, authTagHex] = parts;

        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const key = Buffer.from(keyHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(contentHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return JSON.parse(decrypted);
    },

    /**
     * Generate a Time-based Rotation Key (Simulated TOTP-like)
     * Key changes every 1 minute.
     * @param {number} offsetMinutes - Check previous/next windows
     */
    getTimeBasedKey: (offsetMinutes = 0) => {
        const now = Date.now();
        const minute = Math.floor(now / 60000) + offsetMinutes;
        const secretSalt = process.env.CAPTCHA_SALT || 'SECURE_CAPTCHA_ROTATING_SALT_V1';

        // SHA-256(Salt + Minute) -> 32 bytes hex -> Buffer -> Hex Key
        return crypto.createHash('sha256')
            .update(secretSalt + minute)
            .digest('hex'); // 32 bytes (64 hex chars) - AES-256 needs 32 bytes.
        // Wait, digest('hex') is 64 chars. AES-256 takes 32-byte Buffer or 32-byte binary string (if raw).
        // But our encrypt/decrypt helper takes 'hex' string and does Buffer.from(keyHex, 'hex').
        // SHA256 produces 32 bytes. .digest('hex') makes it 64 chars representing 32 bytes.
        // Our helper: key = Buffer.from(keyHex, 'hex'). 'hex' means input string is hex encoded.
        // So if input is 64 hex chars, Buffer will be 32 bytes. Correct.
    }
};
