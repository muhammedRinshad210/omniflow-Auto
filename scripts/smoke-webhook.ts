/**
 * OmniFlow Real Smoke Test Script under Wrangler Dev (Local D1)
 *
 * 1. Boots wrangler dev on port 8787.
 * 2. Tests GET /api/v1/webhooks/whatsapp verification with challenge=123.
 * 3. Sends HMAC-signed POST /api/v1/webhooks/whatsapp.
 * 4. Displays resulting D1 database records (messages, webhook_events).
 */

import { spawn, execSync } from 'node:child_process';

const PORT = 8787;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const APP_SECRET = 'smoke_test_app_secret';
const VERIFY_TOKEN = 'smoke_test_verify_token';

async function generateHmac(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return (
    'sha256=' +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  );
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(maxAttempts = 60): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {
      // Still booting
    }
    await sleep(500);
  }
  return false;
}

async function main() {
  console.log(`\n======================================================`);
  console.log(`  OmniFlow Wrangler Dev Smoke Test`);
  console.log(`======================================================\n`);

  const hardTimeout = setTimeout(() => {
    console.error(`❌ Smoke test exceeded 120s safety timeout. Forcing termination.`);
    cleanup();
    process.exit(1);
  }, 120000);
  hardTimeout.unref();

  console.log(`Starting wrangler dev on port ${PORT}...`);
  const wranglerProcess = spawn(
    'npx',
    ['wrangler', 'dev', '--config', 'apps/api/wrangler.jsonc', '--port', String(PORT)],
    { shell: true, stdio: 'pipe' }
  );

  let wranglerLogs = '';
  wranglerProcess.stdout?.on('data', (d) => {
    wranglerLogs += d.toString();
  });
  wranglerProcess.stderr?.on('data', (d) => {
    wranglerLogs += d.toString();
  });

  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;
    console.log(`Shutting down wrangler dev...`);
    if (wranglerProcess.pid) {
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /pid ${wranglerProcess.pid} /T /F`, { stdio: 'ignore' });
        } else {
          wranglerProcess.kill('SIGTERM');
        }
      } catch {}
    }
    try {
      wranglerProcess.stdout?.destroy();
      wranglerProcess.stderr?.destroy();
    } catch {}
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  try {
    const isReady = await waitForServer();
    if (!isReady) {
      console.error(`Wrangler dev logs:\n${wranglerLogs}`);
      throw new Error(`Wrangler dev failed to start on port ${PORT} within 30 seconds.`);
    }
    console.log(`✅ Wrangler dev server is READY at ${BASE_URL}\n`);

    // --------------------------------------------------------------------------
    // TEST 1: GET Webhook Verification Handshake
    // --------------------------------------------------------------------------
    console.log(`--- TEST 1: GET Webhook Verification Handshake ---`);
    const challengeVal = '123';
    const verifyUrl = `${BASE_URL}/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=${challengeVal}`;
    const verifyRes = await fetch(verifyUrl);
    const verifyBody = await verifyRes.text();

    console.log(`HTTP Status:   ${verifyRes.status}`);
    console.log(`Response Body: ${verifyBody}`);

    if (verifyRes.status !== 200 || verifyBody !== challengeVal) {
      throw new Error(`GET verification failed: Expected 200 with body '${challengeVal}', got ${verifyRes.status} with body '${verifyBody}'`);
    }
    console.log(`✅ TEST 1 PASSED: Worker returned challenge '${challengeVal}' directly.\n`);

    // --------------------------------------------------------------------------
    // TEST 2: POST Webhook Ingestion & Malayalam Auto-Reply (Dry Run)
    // --------------------------------------------------------------------------
    console.log(`--- TEST 2: POST Webhook Ingestion & Auto-Reply ---`);
    const testWamid = `wamid.SMOKE_${Date.now()}`;
    const webhookPayloadObj = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WH_ACC_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: '999888777' },
                contacts: [{ profile: { name: 'Rinshad' }, wa_id: '919876543210' }],
                messages: [
                  {
                    from: '919876543210',
                    id: testWamid,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    text: { body: 'ഹലോ, വില വിവരങ്ങൾ അറിയണം' },
                    type: 'text'
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    const webhookPayload = JSON.stringify(webhookPayloadObj);
    const signature = await generateHmac(APP_SECRET, webhookPayload);

    console.log(`Sending POST /api/v1/webhooks/whatsapp with HMAC signature...`);
    const postRes = await fetch(`${BASE_URL}/api/v1/webhooks/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature
      },
      body: webhookPayload
    });

    const postBody = await postRes.text();
    console.log(`HTTP Status:   ${postRes.status}`);
    console.log(`Response Body: ${postBody}`);

    if (postRes.status !== 200 || postBody !== 'EVENT_RECEIVED') {
      throw new Error(`POST webhook failed: Expected 200 'EVENT_RECEIVED', got ${postRes.status} '${postBody}'`);
    }
    console.log(`✅ POST Ingestion returned 200 'EVENT_RECEIVED' immediately.`);

    // Wait for background waitUntil processing to write to local D1
    console.log(`Waiting 3s for background processing to finish...`);
    await sleep(3000);

    // --------------------------------------------------------------------------
    // TEST 3: Inspect resulting D1 database records
    // --------------------------------------------------------------------------
    console.log(`\n--- TEST 3: Inspecting & Asserting Local D1 Database Rows ---`);
    const messagesJson = execSync(
      `npx wrangler d1 execute omniflow-db --local --config apps/api/wrangler.jsonc --json --command "SELECT direction, sender_type, delivery_status, is_simulated, body FROM messages WHERE tenant_id = 'ten_smoke_01' ORDER BY created_at DESC LIMIT 2;"`,
      { encoding: 'utf-8' }
    );

    const parsedMessages = JSON.parse(messagesJson);
    const rows = parsedMessages[0]?.results || [];
    console.log('Messages in D1:', JSON.stringify(rows, null, 2));

    const hasSimulatedReply = rows.some(
      (r: any) => r.direction === 'outbound' && r.is_simulated === 1 && r.delivery_status === 'simulated'
    );
    if (!hasSimulatedReply) {
      throw new Error(`TEST 3 FAILED: Expected outbound simulated reply row in D1, found: ${JSON.stringify(rows)}`);
    }

    const eventsJson = execSync(
      `npx wrangler d1 execute omniflow-db --local --config apps/api/wrangler.jsonc --json --command "SELECT dedupe_key, processing_status FROM webhook_events WHERE dedupe_key = '${testWamid}';"`,
      { encoding: 'utf-8' }
    );
    const parsedEvents = JSON.parse(eventsJson);
    const eventRow = parsedEvents[0]?.results?.[0];
    console.log('Webhook Event in D1:', JSON.stringify(eventRow, null, 2));

    if (!eventRow || eventRow.processing_status !== 'processed') {
      throw new Error(`TEST 3 FAILED: Expected webhook_events row for ${testWamid} with processing_status 'processed', got ${JSON.stringify(eventRow)}`);
    }

    console.log(`✅ Real smoke test completed successfully under wrangler dev!\n`);
  } catch (err: unknown) {
    console.error(`❌ Smoke test failed:`, err);
    process.exitCode = 1;
  } finally {
    clearTimeout(hardTimeout);
    cleanup();
  }
}

main()
  .then(() => {
    if (process.exitCode && process.exitCode !== 0) {
      process.exit(process.exitCode);
    }
  })
  .catch((err) => {
    console.error(`❌ Smoke test unhandled failure:`, err);
    process.exit(1);
  });
