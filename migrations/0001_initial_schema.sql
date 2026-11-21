-- ==============================================================================
-- OMNIFLOW D1 DATABASE MIGRATION: 0001_initial_schema.sql
-- Description: Phase 0/1 Foundation Schema
-- Engine: SQLite (Cloudflare D1)
-- Standards: Strict ISO-8601 UTC with Z, tenant_id scoped, foreign keys enabled
-- ==============================================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------------------------
-- 1. TENANTS
-- Single-tenant deployment holds 1 primary business tenant plus optional demo workspace.
-- Multi-tenant ready: all subsequent tables cascade-delete from tenant_id.
-- ------------------------------------------------------------------------------
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_demo INTEGER NOT NULL DEFAULT 0,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ------------------------------------------------------------------------------
-- 2. CHANNEL CONNECTIONS
-- Credentials and metadata for connected WhatsApp, Instagram, and Messenger channels.
-- System user tokens and app secrets are encrypted at rest with AES-256-GCM.
-- ------------------------------------------------------------------------------
CREATE TABLE channel_connections (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,                -- 'whatsapp' | 'instagram' | 'messenger'
    account_id TEXT NOT NULL,                  -- WA Phone Number ID, IG Business ID, or FB Page ID
    name TEXT NOT NULL,                        -- Human-friendly label (e.g. 'Main Support WA')
    encrypted_access_token TEXT NOT NULL,      -- AES-256-GCM encrypted Meta Graph API access token
    token_preview TEXT NOT NULL,               -- Safe preview (e.g. 'EAAG...9xYz')
    webhook_verify_token TEXT NOT NULL,        -- Verification secret configured in Meta App Dashboard
    encrypted_app_secret TEXT,                 -- AES-256-GCM encrypted App Secret for webhook HMAC
    status TEXT NOT NULL DEFAULT 'active',     -- 'active' | 'disconnected' | 'expired'
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, channel_type, account_id)
);
CREATE INDEX idx_channel_connections_tenant ON channel_connections(tenant_id);
CREATE INDEX idx_channel_connections_lookup ON channel_connections(channel_type, account_id);

-- ------------------------------------------------------------------------------
-- 3. CONTACTS
-- Represents customer records.
-- Security: Real recipient ID (WhatsApp wa_id, IG IGSID, FB PSID) is encrypted at rest (AES-256-GCM).
-- Deterministic lookup uses a Keyed HMAC-SHA256 (lookup_hash) from Worker secrets.
-- Only masked values are exposed in UI or logs.
-- ------------------------------------------------------------------------------
CREATE TABLE contacts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,                -- 'whatsapp' | 'instagram' | 'messenger'
    encrypted_platform_sender_id TEXT NOT NULL,-- AES-256-GCM encrypted recipient ID (wa_id / IGSID / PSID)
    lookup_hash TEXT NOT NULL,                 -- Keyed HMAC-SHA256 for O(1) lookup without plaintext PII
    phone_number_masked TEXT,                  -- Masked display value (e.g. '+91 98**** 1234' or '@user')
    display_name TEXT,                         -- Profile display name or push name
    metadata_json TEXT,                        -- JSON: custom tags, locale, notes
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_contacts_tenant ON contacts(tenant_id);
CREATE INDEX idx_contacts_lookup ON contacts(tenant_id, lookup_hash);
CREATE INDEX idx_contacts_channel ON contacts(tenant_id, channel_type);

-- ------------------------------------------------------------------------------
-- 4. CONVERSATIONS
-- Active message thread between a contact and a channel connection.
-- Human handover state and 24-hour customer care window tracking.
-- ------------------------------------------------------------------------------
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel_connection_id TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',       -- 'open' | 'closed' | 'archived'
    handover_state TEXT NOT NULL DEFAULT 'bot',-- 'bot' | 'human_requested' | 'human_assigned'
    last_customer_message_at TEXT,             -- ISO-8601 UTC with Z; checks 24h Meta messaging window
    last_message_preview TEXT,                 -- Truncated text preview for inbox list
    unread_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_connection_id) REFERENCES channel_connections(id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, channel_connection_id, contact_id)
);
CREATE INDEX idx_conversations_tenant_status ON conversations(tenant_id, status);
CREATE INDEX idx_conversations_handover ON conversations(tenant_id, handover_state);
CREATE INDEX idx_conversations_updated ON conversations(tenant_id, updated_at DESC);

-- ------------------------------------------------------------------------------
-- 5. MESSAGES
-- Individual inbound and outbound messages.
-- Outbound rows start with provider_message_id = NULL in 'pending' status.
-- Once Meta API acknowledges delivery, provider_message_id is updated.
-- ------------------------------------------------------------------------------
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    channel_connection_id TEXT NOT NULL,
    direction TEXT NOT NULL,                   -- 'inbound' | 'outbound'
    sender_type TEXT NOT NULL,                 -- 'customer' | 'bot' | 'human_agent'
    message_type TEXT NOT NULL,                -- 'text' | 'image' | 'video' | 'audio' | 'document' | 'interactive' | 'template'
    provider_message_id TEXT,                  -- Meta message ID (nullable for pending outbound messages)
    body TEXT,                                 -- Text content or caption
    payload_json TEXT,                         -- JSON: buttons, attachments, metadata
    delivery_status TEXT NOT NULL DEFAULT 'sent', -- 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
    error_message TEXT,                        -- Plain-language error if delivery failed
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (channel_connection_id) REFERENCES channel_connections(id) ON DELETE CASCADE,
    UNIQUE (channel_connection_id, provider_message_id)
);
CREATE INDEX idx_messages_conversation ON messages(tenant_id, conversation_id, created_at ASC);
CREATE UNIQUE INDEX idx_messages_provider_id_unique ON messages(channel_connection_id, provider_message_id) WHERE provider_message_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 6. WEBHOOK EVENTS
-- Audit and deduplication log for Meta webhook events.
-- Dedupe key formula per channel:
--   - Inbound message: provider_message_id
--   - Status update (sent/delivered/read/failed): provider_message_id + ':' + status + ':' + timestamp
-- Raw payload is minimized to prevent D1 bloat & PII exposure.
-- retention_expires_at is set for automatic 7-14 day pruning.
-- ------------------------------------------------------------------------------
CREATE TABLE webhook_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    channel_connection_id TEXT,
    channel_type TEXT NOT NULL,                -- 'whatsapp' | 'instagram' | 'messenger'
    event_type TEXT NOT NULL,                  -- 'message' | 'message_status'
    dedupe_key TEXT NOT NULL,                  -- Channel-specific composite deduplication key
    payload_summary_json TEXT NOT NULL,        -- Sanitized, minimal JSON (status, recipient hash, error code)
    raw_payload_preview TEXT,                  -- Truncated safe preview (max 500 chars)
    processing_status TEXT NOT NULL DEFAULT 'received',  -- 'received' | 'processed' | 'duplicate' | 'ignored' | 'failed'
    error_details TEXT,
    retention_expires_at TEXT NOT NULL,        -- UTC date when event row is eligible for purge (7-14 days)
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    UNIQUE (tenant_id, channel_type, dedupe_key)
);
CREATE INDEX idx_webhook_events_dedupe ON webhook_events(tenant_id, channel_type, dedupe_key);
CREATE INDEX idx_webhook_events_retention ON webhook_events(retention_expires_at);

-- ------------------------------------------------------------------------------
-- 7. AUTOMATION RULES
-- User-defined triggers and automated replies.
-- Supports keyword triggers (Malayalam and English), greetings, fallbacks, and human handover actions.
-- ------------------------------------------------------------------------------
CREATE TABLE automation_rules (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,                        -- e.g. 'Business Hours Malayalam Greeting'
    channel_type TEXT NOT NULL DEFAULT 'all',  -- 'all' | 'whatsapp' | 'instagram' | 'messenger'
    trigger_type TEXT NOT NULL,                -- 'keyword_exact' | 'keyword_contains' | 'greeting' | 'default_fallback' | 'out_of_hours'
    trigger_config_json TEXT NOT NULL,         -- JSON array: ["rate", "price", "വില", "വിവരം"]
    response_type TEXT NOT NULL DEFAULT 'text',-- 'text' | 'template' | 'handover'
    response_content_json TEXT NOT NULL,       -- JSON: {"en": "Hello! ...", "ml": "നമസ്കാരം! ..."}
    priority INTEGER NOT NULL DEFAULT 0,       -- Higher priority evaluates first
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_automation_rules_active ON automation_rules(tenant_id, is_active, priority DESC);
