import { Hono } from 'hono';
import { healthRouter } from './routes/health.ts';
import { whatsappWebhookRouter } from './routes/webhooks/whatsapp.ts';
import { createMessagingWebhookRouter } from './routes/webhooks/messaging.ts';
import { createAdminRouter } from './routes/admin.ts';
import { purgeExpiredWebhookEvents } from './services/purge.ts';
import type { Env } from './types/env.ts';

const app = new Hono<{ Bindings: Env }>();

// Global Security Headers Middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'interest-cohort=()');
});

// Mount routes
app.route('/', healthRouter);
app.route('/api/v1/webhooks', whatsappWebhookRouter);
app.route('/api/v1/webhooks', createMessagingWebhookRouter('facebook'));
app.route('/api/v1/webhooks', createMessagingWebhookRouter('instagram'));
app.route('/api/v1/admin', createAdminRouter());

// Static SPA fallback (Phase 3 dashboard).
// With run_worker_first = true, every request reaches the Worker first.
// Non-API paths are forwarded to the Static Assets binding, which serves the
// compiled Vite SPA and falls back to index.html (single-page-application)
// for client-side routes like /login or /inbox.
app.all('*', (c) => {
  const assets = (c.env as Env | undefined)?.ASSETS;
  if (assets && typeof assets.fetch === 'function') {
    return assets.fetch(c.req.raw);
  }
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not Found', path: c.req.path }, 404);
});

// Global error handler
app.onError((err, c) => {
  console.error(`[Unhandled Error] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export const honoApp = app;

export default {
  fetch: app.fetch,
  async scheduled(
    _event: { cron: string; scheduledTime: number },
    env: Env,
    ctx: { waitUntil: (p: Promise<any>) => void }
  ) {
    ctx.waitUntil(purgeExpiredWebhookEvents(env.DB));
  }
};
