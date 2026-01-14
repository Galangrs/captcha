import { z } from 'zod';
import Joi from 'joi';
import { errorResponse } from '../utils/response.util.js';

/**
 * Dynamic Validation Middleware
 * Supports validation for: body, query, params
 * Supports schemas: Zod, Joi
 * 
 * Usage:
 * validate({
 *   body: ZodSchema,
 *   query: JoiSchema
 * })
 */
export const validate = (schemas) => {
    return async (req, res, next) => {
        try {
            const validations = [];

            // 1. Validate Body
            if (schemas.body) {
                console.log('[Middleware] Content-Type:', req.headers['content-type']);
                console.log('[Middleware] Body:', JSON.stringify(req.body, null, 2));
                validations.push(validateOne(schemas.body, req.body, 'body'));
            }

            // 2. Validate Query
            if (schemas.query) {
                validations.push(validateOne(schemas.query, req.query, 'query'));
            }

            // 3. Validate Params
            if (schemas.params) {
                validations.push(validateOne(schemas.params, req.params, 'params'));
            }

            // Execute all validations
            await Promise.all(validations);

            next();
        } catch (error) {
            // Format error message based on source (body/query/params)
            console.error('[Validation Error Caught]:');
            if (error instanceof Error) {
                console.error('Message:', error.message);
                console.error('Stack:', error.stack);
            } else {
                console.error('Data:', JSON.stringify(error, null, 2));
            }
            return errorResponse(res, 'Validation Error', 400, error);
        }
    };
};

const validateOne = async (schema, data, type) => {
    // Check if Zod Schema (has safeParse method)
    if (isZodSchema(schema)) {
        console.log(`[Middleware] Detected Zod Schema for ${type}`);
        try {
            // Use synchronous safeParse as standard Zod schemas are sync unless using async refinements
            const result = schema.safeParse(data);

            if (!result.success) {
                console.log(`[Middleware] Zod Validation Failed for ${type}:`, JSON.stringify(result.error.errors));
                const formattedErrors = result.error.errors.map(err => ({
                    field: err.path.join('.'),
                    message: err.message,
                    location: type
                }));
                throw formattedErrors;
            }
            console.log(`[Middleware] Zod Validation Passed for ${type}`);
            return true;
        } catch (err) {
            // If it's the array we just threw, rethrow it
            if (Array.isArray(err)) throw err;

            // Otherwise it's an unexpected error in Zod execution
            console.error(`[Middleware] Zod Execution Error:`, err);
            throw err;
        }
    }

    // Check if Joi Schema (has validate method)
    else if (isJoiSchema(schema)) {
        const { error, value } = schema.validate(data, { abortEarly: false, stripUnknown: true });
        if (error) {
            const formattedErrors = error.details.map(err => ({
                field: err.path.join('.'),
                message: err.message,
                location: type
            }));
            throw formattedErrors;
        }
        // Replace data with validated/trimmed data (Joi mutates or returns new value)
        return true;
    }

    throw [{ message: 'Invalid schema type provided', location: 'server' }];
};

// Helper: Detect Zod Schema
const isZodSchema = (schema) => {
    return schema && typeof schema.safeParse === 'function';
};

// Helper: Detect Joi Schema
const isJoiSchema = (schema) => {
    return schema && schema.isJoi === true;
};
