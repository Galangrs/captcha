import serverless from 'serverless-http';
import app from '../../src/app/server.js';

export const handler = serverless(app);
