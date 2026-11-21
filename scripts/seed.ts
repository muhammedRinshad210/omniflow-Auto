/**
 * OmniFlow Safe Database Seeding Script (Local & Remote)
 *
 * Usage:
 *   npm run seed:local
 *   npm run seed:remote
 *
 * Security:
 * - Reads tokens via environment variables or interactive prompt.
 * - Encrypts the Meta system user access token with AES-256-GCM BEFORE writing to D1.
 * - Never prints or commits raw secrets.
 */

import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function encryptAesGcm(plaintext: string, base64Key: string): Promise<string> {
  const rawKey = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encodedText
  );

  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
  const ciphertextHex = Array.from(new Uint8Array(ciphertextBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `v1:${ivHex}:${ciphertextHex}`;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.setRawMode) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    let input = '';
    const onData = (chunk: Buffer) => {
      const char = chunk.toString();
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input.trim());
      } else if (char === '\u0003') {
        process.exit(1);
      } else if (char === '\b' || char === '\x7f') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    stdin.on('data', onData);
  });
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

async function main() {
  const isRemote = process.argv.includes('--remote');
  const targetLabel = isRemote ? '--remote' : '--local';

  console.log(`\n======================================================`);
  console.log(`  OmniFlow Safe Database Seeding (${targetLabel.toUpperCase()})`);
  console.log(`======================================================\n`);

  const tenantId = process.env.SEED_TENANT_ID || 'ten_client_01';
  const tenantName = process.env.SEED_TENANT_NAME || 'OmniFlow Client';
  const tenantSlug = tenantName.toLowerCase().replace(/[^a-z0-9]/g, '-');

  const phoneNumberId =
    process.env.WA_PHONE_NUMBER_ID ||
    (await promptHidden('Enter Meta WhatsApp Phone Number ID: '));

  let accessToken = process.env.WA_ACCESS_TOKEN;
  if (!accessToken) {
    accessToken = await promptHidden('Enter Meta System User Access Token: ');
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error('Error: ENCRYPTION_KEY environment variable is required to seed channel connections.');
    console.error('Generate a 32-byte key using: node -e "console.log(crypto.randomBytes(32).toString(\'base64\'))"');
    process.exit(1);
  }

  const automationMode = process.env.AUTOMATION_MODE || 'off';
  const dryRun = process.env.DRY_RUN !== undefined ? parseInt(process.env.DRY_RUN, 10) : 1;
  const allowlistJson = process.env.ALLOWLIST || '[]';

  if (!phoneNumberId || !accessToken) {
    console.error('Error: WhatsApp Phone Number ID and Access Token are required to seed.');
    process.exit(1);
  }

  const tokenPreview = `...${accessToken.slice(-4)}`;
  const encryptedToken = await encryptAesGcm(accessToken, encryptionKey);

  const channelId = `conn_wa_${phoneNumberId}`;

  // Build Seeding SQL
  const sqlStatements = [
    `-- 1. Tenant`,
    `INSERT OR IGNORE INTO tenants (id, name, slug) VALUES ('${escapeSql(tenantId)}', '${escapeSql(tenantName)}', '${escapeSql(tenantSlug)}');`,

    `-- 2. Tenant Settings`,
    `INSERT OR REPLACE INTO tenant_settings (tenant_id, automation_mode, dry_run, allowlist_json, default_language, handover_timeout_minutes, business_hours_json) VALUES ('${escapeSql(tenantId)}', '${escapeSql(automationMode)}', ${dryRun}, '${escapeSql(allowlistJson)}', 'ml', 30, '{"startHour":9,"endHour":18,"timezone":"Asia/Kolkata"}');`,

    `-- 3. WhatsApp Channel Connection`,
    `INSERT OR REPLACE INTO channel_connections (id, tenant_id, channel_type, account_id, name, encrypted_access_token, token_preview, webhook_verify_token, status) VALUES ('${escapeSql(channelId)}', '${escapeSql(tenantId)}', 'whatsapp', '${escapeSql(phoneNumberId)}', 'WhatsApp Business Cloud', '${escapeSql(encryptedToken)}', '${escapeSql(tokenPreview)}', 'omniflow_verify_secret', 'active');`,

    `-- 4. Sample Rule 1: Greeting`,
    `INSERT OR REPLACE INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active) VALUES ('rule_greeting', '${escapeSql(tenantId)}', 'Greeting', 'whatsapp', 'keyword_exact', '["hi","hello","namaskaram","നമസ്കാരം","ഹലോ"]', 'text', '{"en":"Hello! Thank you for reaching out to us. How can we help you today?","ml":"നമസ്കാരം! ഞങ്ങളെ ബന്ധപ്പെട്ടതിന് നന്ദി. ഇന്ന് നിങ്ങളെ എങ്ങനെ സഹായിക്കാനാകും?"}', 10, 1);`,

    `-- 5. Sample Rule 2: Brochure / Pricing`,
    `INSERT OR REPLACE INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active) VALUES ('rule_pricing', '${escapeSql(tenantId)}', 'Pricing & Brochure', 'whatsapp', 'keyword_contains', '["price","rate","cost","brochure","വില","വിവരം","ചിലവ്"]', 'text', '{"en":"Our service pricing starts from Rs. 500. A detailed brochure will be shared shortly.","ml":"ഞങ്ങളുടെ സേവനങ്ങൾ 500 രൂപ മുതൽ ലഭ്യമാണ്. കൂടുതൽ വിവരങ്ങൾ ഉടൻ അറിയിക്കുന്നതാണ്."}', 20, 1);`,

    `-- 6. Sample Rule 3: Default Fallback`,
    `INSERT OR REPLACE INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active) VALUES ('rule_fallback', '${escapeSql(tenantId)}', 'Default Fallback', 'whatsapp', 'default_fallback', '[]', 'text', '{"en":"Thank you for your message. Our staff will review your inquiry and respond shortly.","ml":"നിങ്ങളുടെ സന്ദേശത്തിന് നന്ദി. ഞങ്ങളുടെ പ്രതിനിധി ഉടൻ തന്നെ താങ്കളെ ബന്ധപ്പെടുന്നതാണ്."}', 0, 1);`,

    `INSERT OR REPLACE INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active) VALUES ('rule_fallback_instagram', '${escapeSql(tenantId)}', 'Default Fallback', 'instagram', 'default_fallback', '[]', 'text', '{"en":"Thank you for your message. Our staff will review your inquiry and respond shortly.","ml":"നിങ്ങളുടെ സന്ദേശത്തിന് നന്ദി. ഞങ്ങളുടെ പ്രതിനിധി ഉടൻ തന്നെ താങ്കളെ ബന്ധപ്പെടുന്നതാണ്."}', 0, 1);`,

    `INSERT OR REPLACE INTO automation_rules (id, tenant_id, name, channel_type, trigger_type, trigger_config_json, response_type, response_content_json, priority, is_active) VALUES ('rule_fallback_messenger', '${escapeSql(tenantId)}', 'Default Fallback', 'messenger', 'default_fallback', '[]', 'text', '{"en":"Thank you for your message. Our staff will review your inquiry and respond shortly.","ml":"നിങ്ങളുടെ സന്ദേശത്തിന് നന്ദി. ഞങ്ങളുടെ പ്രതിനിധി ഉടൻ തന്നെ താങ്കളെ ബന്ധപ്പെടുന്നതാണ്."}', 0, 1);`

  ].join('\n');

  // Execute via temporary SQL file to avoid exposing queries in process arguments
  const tempSqlPath = join(tmpdir(), `omniflow_seed_${Date.now()}.sql`);
  writeFileSync(tempSqlPath, sqlStatements, 'utf-8');

  try {
    console.log(`Applying seed data to D1 (${targetLabel})...`);
    execSync(
      `npx wrangler d1 execute omniflow-db ${targetLabel} --config apps/api/wrangler.jsonc --file="${tempSqlPath}"`,
      { stdio: 'inherit' }
    );
    console.log(`\n✅ Seeding successful!`);
    console.log(`   Tenant ID:        ${tenantId}`);
    console.log(`   Automation Mode:  ${automationMode}`);
    console.log(`   Dry Run:          ${dryRun === 1 ? 'ENABLED (Simulated)' : 'DISABLED (Real)'}`);
    console.log(`   Token Preview:    ${tokenPreview}`);
    console.log(`   Channel Account:  ${phoneNumberId}`);
    console.log(`   Rules Seeded:     3 (Greeting, Pricing, Fallback)`);
  } catch (err: unknown) {
    console.error(`\n❌ Seeding failed:`, err instanceof Error ? err.message : err);
    process.exit(1);
  } finally {
    try {
      unlinkSync(tempSqlPath);
    } catch {
      // Ignore cleanup error
    }
  }
}

main().catch(console.error);
