import type { D1Database } from '@cloudflare/workers-types';

export interface PurgeResult {
  purgedCount: number;
}

/**
 * Purges expired webhook_events to ensure database storage remains within free-tier limits.
 */
export async function purgeExpiredWebhookEvents(
  db: D1Database,
  tenantId?: string
): Promise<PurgeResult> {
  const query = tenantId
    ? `DELETE FROM webhook_events WHERE tenant_id = ? AND retention_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`
    : `DELETE FROM webhook_events WHERE retention_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`;

  const stmt = tenantId ? db.prepare(query).bind(tenantId) : db.prepare(query);
  const result = await stmt.run();

  return {
    purgedCount: result.meta.rows_written ?? 0
  };
}
