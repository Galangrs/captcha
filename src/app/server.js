import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import router from './router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import zlib from 'zlib';
import { errorResponse } from '../core/utils/response.util.js';

const app = express();

import 'dotenv/config';
// Security & Optimization Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            fontSrc: ["'self'", "data:"],
            frameAncestors: ["*"], // Allow embedding in iframes
        },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '*')
    .split(',')
    .map(origin => origin.trim().replace(/\/$/, '').replace(/\/\*$/, ''));

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        // DEBUG: Log origin check
        if (!origin) return callback(null, true);

        console.log(`[CORS DEBUG] Origin: '${origin}'`);
        console.log(`[CORS DEBUG] Allowed:`, allowedOrigins);

        if (allowedOrigins.includes('*') || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            callback(new Error(`Not allowed by CORS: ${origin}`));
        }
    },
    credentials: true // Set to true if we expect cookies/auth headers later
}));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));
import { dynamicRouter } from '../core/services/DynamicRouteService.js';

// Dynamic Router Middleware
app.use(async (req, res, next) => {
    const match = dynamicRouter.match(req.path, req.method);
    if (!match) return next();

    console.log(`[DynamicRouter] Matched: ${req.method} ${req.path}`);

    // Attach context for downstream middleware
    req.dynamicContext = match.context || {};

    // Execute middleware chain (Validation -> Controller)
    const chain = [...(match.middleware || []), match.handler];

    let index = 0;
    const runChain = async () => {
        if (index >= chain.length) return;
        const currentFn = chain[index++];

        try {
            await currentFn(req, res, (err) => {
                if (err) return next(err);
                runChain();
            });
        } catch (e) {
            next(e);
        }
    };

    runChain();
});

// Serve CDN files
const cdnPath = path.join(__dirname, '../public/cdn');
console.log('Serving CDN from:', cdnPath);

// Obfuscation Middleware for .js (Simulated Binary for Curl)
app.use('/cdn', (req, res, next) => {
    // 1. Sanitize Path
    const safePth = path.normalize(req.url).replace(/^(\.\.[\/\\])+/, '');
    const validPath = path.join(cdnPath, safePth);

    if (!validPath.startsWith(cdnPath)) {
        return res.status(403).send('Forbidden');
    }

    if (req.url.endsWith('.js')) {
        // Read as buffer (binary)
        fs.readFile(validPath, (err, data) => {
            if (err) return next();

            // Compress to Binary (Gzip)
            zlib.gzip(data, (error, compressed) => {
                if (error) return next(error);

                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Content-Encoding', 'gzip'); // Browser decodes this, Curl sees binary
                return res.send(compressed);
            });
        });
    } else {
        next();
    }
});

app.use('/cdn', express.static(cdnPath));

// Main Router
app.use(router);

// 404 Handler
app.use((req, res) => {
    errorResponse(res, 'Route not found', 404);
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[Global Error]', err);
    // If it's a validation error array (from our middleware), pass it through
    if (Array.isArray(err)) {
        return errorResponse(res, 'Validation Error', 400, err);
    }
    errorResponse(res, err.message || 'Internal Server Error', 500);
});

export default app;
