import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database } from '@cloudflare/workers-types';
import worker from '../apps/api/src/index.ts';

function createTestD1(db: DatabaseSync): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: any[]) {
          return {
            async run() {
              const info = db.prepare(sql).run(...args);
              return { success: true, meta: { rows_written: Number(info.changes) } };
            },
            async all<T = any>() {
              const rows = db.prepare(sql).all(...args) as T[];
              return { success: true, results: rows };
            },
            async first<T = any>(col?: string): Promise<T | null> {
              const row = db.prepare(sql).get(...args) as any;
              if (!row) return null;
              return col ? row[col] : (row as T);
            }
          };
        },
        async run() {
          const info = db.prepare(sql).run();
          return { success: true, meta: { rows_written: Number(info.changes) } };
        },
        async all<T = any>() {
          const rows = db.prepare(sql).all() as T[];
          return { success: true, results: rows };
        },
        async first<T = any>(col?: string): Promise<T | null> {
          const row = db.prepare(sql).get() as any;
          if (!row) return null;
          return col ? row[col] : (row as T);
        }
      };
    }
  } as unknown as D1Database;
}

describe('Worker Scheduled Handler Tests', () => {
  test('scheduled() invokes purgeExpiredWebhookEvents and deletes expired rows', async () => {
    const db = new DatabaseSync(':memory:');
    const m1 = readFileSync(join(process.cwd(), 'migrations', '0001_initial_schema.sql'), 'utf-8');
    const m2 = readFileSync(join(process.cwd(), 'migrations', '0002_tenant_settings.sql'), 'utf-8');
    const m3 = readFileSync(join(process.cwd(), 'migrations', '0003_automation_settings.sql'), 'utf-8');
    db.exec(m1);
    db.exec(m2);
    db.exec(m3);

    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_purge_test', 'Purge Test', 'purge-test')").run();

    // 1. Expired event (retention in past)
    db.prepare(`
      INSERT INTO webhook_events (
        id, tenant_id, channel_type, event_type, dedupe_key,
        payload_summary_json, retention_expires_at
      ) VALUES ('wh_expired_1', 'ten_purge_test', 'whatsapp', 'message', 'dedupe_exp_1', '{}', '2020-01-01T00:00:00.000Z')
    `).run();

    // 2. Non-expired event (retention in future)
    db.prepare(`
      INSERT INTO webhook_events (
        id, tenant_id, channel_type, event_type, dedupe_key,
        payload_summary_json, retention_expires_at
      ) VALUES ('wh_active_1', 'ten_purge_test', 'whatsapp', 'message', 'dedupe_act_1', '{}', '2030-01-01T00:00:00.000Z')
    `).run();

    const d1 = createTestD1(db);
    let waitPromise: Promise<any> | null = null;

    const mockCtx = {
      waitUntil(p: Promise<any>) {
        waitPromise = p;
      }
    };

    const env = { DB: d1 };

    await worker.scheduled({ cron: '0 3 * * *', scheduledTime: Date.now() }, env as any, mockCtx as any);
    if (waitPromise) {
      await waitPromise;
    }

    const remainingRows = db.prepare('SELECT id FROM webhook_events').all() as any[];
    assert.equal(remainingRows.length, 1);
    assert.equal(remainingRows[0].id, 'wh_active_1', 'Only non-expired row must remain');
  });
});
