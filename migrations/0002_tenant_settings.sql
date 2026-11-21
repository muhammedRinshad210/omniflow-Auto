-- ==============================================================================
-- OMNIFLOW D1 DATABASE MIGRATION: 0002_tenant_settings.sql
-- Description: Tenant automation safety controls, recipient allowlisting,
--              in_reply_to deduplication guard, and simulated dry-run flags.
-- ==============================================================================

-- 1. TENANT SETTINGS (Automation safety modes & recipient allowlisting)
CREATE TABLE tenant_settings (
    tenant_id TEXT PRIMARY KEY,
    automation_mode TEXT NOT NULL CHECK (automation_mode IN ('off', 'test', 'live')) DEFAULT 'off',
    dry_run INTEGER NOT NULL DEFAULT 1,
    allowlist_json TEXT NOT NULL DEFAULT '[]',
    default_language TEXT NOT NULL DEFAULT 'ml',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- 2. MESSAGES TABLE UPDATES
-- Guarantee exactly one auto-reply per inbound message via unique in_reply_to_message_id
ALTER TABLE messages ADD COLUMN in_reply_to_message_id TEXT;
CREATE UNIQUE INDEX idx_messages_in_reply_to ON messages(in_reply_to_message_id) WHERE in_reply_to_message_id IS NOT NULL;

-- Mark simulated dry-run outbound messages so they never look like real sent messages
ALTER TABLE messages ADD COLUMN is_simulated INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_messages_simulated ON messages(tenant_id, is_simulated);
