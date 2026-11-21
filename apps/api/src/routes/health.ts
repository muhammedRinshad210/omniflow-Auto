import { Hono } from 'hono';
import type { Env } from '../types/env.ts';
import type { HealthResponse } from '@omniflow/shared';

export const healthRouter = new Hono<{ Bindings: Env }>();

const startTime = Date.now();

healthRouter.get('/health', (c) => {
  const env = c.env;
  const now = new Date();

  const response: HealthResponse = {
    status: 'ok',
    app: env?.APP_NAME || 'OmniFlow',
    version: env?.APP_VERSION || '0.1.0',
    timestamp: now.toISOString(),
    environment: env?.ENVIRONMENT || 'development',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000)
  };

  return c.json(response, 200);
});
