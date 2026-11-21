import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('OmniFlow D1 Migration v1, v2 & v3 Integrity Tests', () => {
  const db = new DatabaseSync(':memory:');
  const migration1Path = join(process.cwd(), 'migrations', '0001_initial_schema.sql');
  const migration2Path = join(process.cwd(), 'migrations', '0002_tenant_settings.sql');
  const migration3Path = join(process.cwd(), 'migrations', '0003_automation_settings.sql');

  const migration1Sql = readFileSync(migration1Path, 'utf-8');
  const migration2Sql = readFileSync(migration2Path, 'utf-8');
  const migration3Sql = readFileSync(migration3Path, 'utf-8');

  test('Migration 0001, 0002 & 0003 execute cleanly without syntax errors', () => {
    assert.doesNotThrow(() => {
      db.exec(migration1Sql);
      db.exec(migration2Sql);
      db.exec(migration3Sql);
    });
  });

  test('All foundational tables exist including tenant_settings', () => {
    const expectedTables = [
      'tenants',
      'tenant_settings',
      'channel_connections',
      'contacts',
      'conversations',
      'messages',
      'webhook_events',
      'automation_rules'
    ];

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);

    for (const expected of expectedTables) {
      assert.ok(tableNames.includes(expected), `Table ${expected} must exist`);
    }
  });

  test('Tenant creation and tenant_settings safety check constraints', () => {
    db.prepare(`
      INSERT INTO tenants (id, name, slug, timezone)
      VALUES (?, ?, ?, ?)
    `).run('ten_test_01', 'Test Clinic', 'test-clinic', 'Asia/Kolkata');

    db.prepare(`
      INSERT INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language)
      VALUES (?, 'off', 1, '[]', 'ml')
    `).run('ten_test_01');

    const settings = db.prepare('SELECT * FROM tenant_settings WHERE tenant_id = ?').get('ten_test_01') as {
      automation_mode: string;
      dry_run: number;
      handover_timeout_minutes: number | null;
      business_hours_json: string | null;
    };

    assert.equal(settings.automation_mode, 'off');
    assert.equal(settings.dry_run, 1);
    assert.equal(settings.handover_timeout_minutes, null);
    assert.equal(settings.business_hours_json, null);

    // Invalid automation_mode must fail check constraint
    assert.throws(() => {
      db.prepare(`
        INSERT INTO tenant_settings (tenant_id, automation_mode)
        VALUES ('ten_invalid', 'invalid_mode')
      `).run();
    }, /CHECK constraint failed/);
  });

  test('Messages in_reply_to_message_id UNIQUE constraint strictly prevents duplicate replies', () => {
    db.prepare(`
      INSERT INTO channel_connections (
        id, tenant_id, channel_type, account_id, name,
        encrypted_access_token, token_preview, webhook_verify_token
      ) VALUES ('conn_01', 'ten_test_01', 'whatsapp', '12345', 'WA', 'v1:a:b', 'EAA...', 'token')
    `).run();

    db.prepare(`
      INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash)
      VALUES ('cnt_01', 'ten_test_01', 'whatsapp', 'v1:c:d', 'hash123')
    `).run();

    db.prepare(`
      INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id)
      VALUES ('conv_01', 'ten_test_01', 'conn_01', 'cnt_01')
    `).run();

    const inboundId = 'msg_inbound_target';
    db.prepare(`
      INSERT INTO messages (
        id, tenant_id, conversation_id, channel_connection_id,
        direction, sender_type, message_type, provider_message_id, body
      ) VALUES (?, 'ten_test_01', 'conv_01', 'conn_01', 'inbound', 'customer', 'text', 'wamid.123', 'Hi')
    `).run(inboundId);

    // First auto-reply with in_reply_to_message_id succeeds
    db.prepare(`
      INSERT INTO messages (
        id, tenant_id, conversation_id, channel_connection_id,
        direction, sender_type, message_type, body, delivery_status, in_reply_to_message_id, is_simulated
      ) VALUES ('msg_out_1', 'ten_test_01', 'conv_01', 'conn_01', 'outbound', 'bot', 'text', 'Reply 1', 'simulated', ?, 1)
    `).run(inboundId);

    // Second auto-reply targeting the SAME inbound message MUST fail unique constraint
    assert.throws(() => {
      db.prepare(`
        INSERT INTO messages (
          id, tenant_id, conversation_id, channel_connection_id,
          direction, sender_type, message_type, body, delivery_status, in_reply_to_message_id, is_simulated
        ) VALUES ('msg_out_2', 'ten_test_01', 'conv_01', 'conn_01', 'outbound', 'bot', 'text', 'Reply 2', 'simulated', ?, 1)
      `).run(inboundId);
    }, /UNIQUE constraint failed/);
  });
});
