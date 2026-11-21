import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('OmniFlow Multi-Tenant Isolation Tests', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    const m1 = readFileSync(join(process.cwd(), 'migrations', '0001_initial_schema.sql'), 'utf-8');
    const m2 = readFileSync(join(process.cwd(), 'migrations', '0002_tenant_settings.sql'), 'utf-8');
    const m3 = readFileSync(join(process.cwd(), 'migrations', '0003_automation_settings.sql'), 'utf-8');
    db.exec(m1);
    db.exec(m2);
    db.exec(m3);

    // Tenant A
    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_alpha', 'Tenant Alpha', 'ten-alpha')").run();
    db.prepare("INSERT INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token) VALUES ('conn_a', 'ten_alpha', 'whatsapp', '111', 'Alpha WA', 'v1:a:b', 'EAA...', 'token_a')").run();
    db.prepare("INSERT INTO contacts (id, tenant_id, channel_type, encrypted_platform_sender_id, lookup_hash) VALUES ('cnt_a', 'ten_alpha', 'whatsapp', 'v1:c:d', 'hash_a')").run();
    db.prepare("INSERT INTO conversations (id, tenant_id, channel_connection_id, contact_id) VALUES ('conv_a', 'ten_alpha', 'conn_a', 'cnt_a')").run();
    db.prepare("INSERT INTO messages (id, tenant_id, conversation_id, channel_connection_id, direction, sender_type, message_type, body) VALUES ('msg_a', 'ten_alpha', 'conv_a', 'conn_a', 'inbound', 'customer', 'text', 'Secret Alpha Data')").run();

    // Tenant B
    db.prepare("INSERT INTO tenants (id, name, slug) VALUES ('ten_beta', 'Tenant Beta', 'ten-beta')").run();
    db.prepare("INSERT INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token) VALUES ('conn_b', 'ten_beta', 'whatsapp', '222', 'Beta WA', 'v1:x:y', 'EBB...', 'token_b')").run();
  });

  test('Tenant B queries cannot access Tenant A messages or contacts', () => {
    const tenantBMessages = db
      .prepare('SELECT * FROM messages WHERE tenant_id = ?')
      .all('ten_beta');
    assert.equal(tenantBMessages.length, 0, 'Tenant B must see 0 messages');

    const tenantBContacts = db
      .prepare('SELECT * FROM contacts WHERE tenant_id = ?')
      .all('ten_beta');
    assert.equal(tenantBContacts.length, 0, 'Tenant B must see 0 contacts');
  });

  test('Tenant B update cannot modify Tenant A conversation status', () => {
    db.prepare("UPDATE conversations SET status = 'closed' WHERE tenant_id = ?")
      .run('ten_beta');

    const alphaConv = db
      .prepare('SELECT status FROM conversations WHERE id = ?')
      .get('conv_a') as any;
    assert.equal(alphaConv.status, 'open', 'Tenant A conversation must remain untouched');
  });

  test('Deleting Tenant B does not cascade-delete Tenant A data', () => {
    db.prepare('DELETE FROM tenants WHERE id = ?').run('ten_beta');

    const alphaMessages = db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE tenant_id = ?')
      .get('ten_alpha') as any;
    assert.equal(alphaMessages.count, 1, 'Tenant A data must remain intact');
  });
});
