import type { D1Database } from '@cloudflare/workers-types';

/**
 * Worker Environment Bindings
 * Declares all secrets, vars, and Cloudflare platform bindings.
 */
export interface Env {
  // Cloudflare D1 Database binding
  DB: D1Database;

  // Static Assets binding (serves the compiled SPA from apps/web/dist)
  ASSETS?: {
    fetch: (request: Request) => Promise<Response>;
  };

  // Environment Variables
  ENVIRONMENT?: string;
  APP_NAME?: string;
  APP_VERSION?: string;
  GRAPH_API_VERSION?: string; // Configurable Meta Graph API version (default 'v22.0')
  DEFAULT_TENANT_ID?: string;

  // Worker Secrets (Configured via `wrangler secret put <NAME>` or .dev.vars)
  ENCRYPTION_KEY?: string;
  LOOKUP_HASH_SECRET?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;

  // Dashboard admin access (single shared password for the pilot)
  ADMIN_PASSWORD?: string;
}
