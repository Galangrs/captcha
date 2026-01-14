import crypto from 'crypto';

class DynamicRouteService {
    constructor() {
        // Map<pathString, { handler: Function, method: String, middleware: Array, createdAt: Number }>
        this.routes = new Map();

        // Cleanup every 1 minute
        setInterval(() => this.cleanup(), 60 * 1000);
    }

    /**
     * Generate a random path
     * @returns {string} e.g. "a1b2c3d4..."
     */
    generatePath() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Register a dynamic route
     * @param {string} path - The relative path (e.g. "abc...")
     * @param {string} method - HTTP Method (POST, GET)
     * @param {Function} handler - Express controller function
     * @param {Array} middleware - Optional middleware stack
     */
    register(path, method, handler, middleware = [], context = {}) {
        this.routes.set(path, {
            method: method.toUpperCase(),
            handler,
            middleware,
            context,
            createdAt: Date.now()
        });
    }

    /**
     * Remove expired routes (> 10 mins)
     */
    cleanup() {
        const now = Date.now();
        for (const [path, route] of this.routes.entries()) {
            if (now - route.createdAt > 10 * 60 * 1000) {
                this.routes.delete(path);
            }
        }
    }

    /**
     * Get handler for a path
     * @param {string} path 
     * @returns {Object|null}
     */
    match(path, method) {
        // Strip leading slash if present
        const cleanPath = path.startsWith('/') ? path.slice(1) : path;

        const route = this.routes.get(cleanPath);
        if (route && route.method === method.toUpperCase()) {
            return route;
        }
        return null;
    }
}

export const dynamicRouter = new DynamicRouteService();
