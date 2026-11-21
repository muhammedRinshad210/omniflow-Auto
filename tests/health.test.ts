import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { honoApp } from '../apps/api/src/index.ts';

describe('OmniFlow API Walking Skeleton Tests', () => {
  test('GET /health returns 200 OK with valid schema', async () => {
    const req = new Request('http://localhost/health');
    const res = await honoApp.fetch(req);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true);

    const data = await res.json() as {
      status: string;
      app: string;
      version: string;
      timestamp: string;
      environment: string;
      uptimeSeconds: number;
    };

    assert.equal(data.status, 'ok');
    assert.equal(data.app, 'OmniFlow');
    assert.equal(data.version, '0.1.0');
    assert.equal(typeof data.timestamp, 'string');
    assert.ok(!isNaN(Date.parse(data.timestamp)), 'Timestamp must be valid ISO-8601');
    assert.equal(typeof data.uptimeSeconds, 'number');
  });

  test('GET / serves the SPA via ASSETS binding, JSON 404 without it', async () => {
    // Without the ASSETS binding (API-only context, e.g. unit tests): JSON 404
    const res = await honoApp.fetch(new Request('http://localhost/'));
    assert.equal(res.status, 404);
    const data = await res.json() as { error: string };
    assert.equal(data.error, 'Not Found');

    // With an ASSETS binding: the request is forwarded to the static SPA
    let forwarded = false;
    const res2 = await honoApp.fetch(new Request('http://localhost/'), {
      ASSETS: {
        fetch: async (_req: Request) => {
          forwarded = true;
          return new Response('<!doctype html><html><body>OmniFlow SPA</body></html>', {
            headers: { 'content-type': 'text/html; charset=utf-8' }
          });
        }
      }
    } as any);

    assert.equal(forwarded, true);
    assert.equal(res2.status, 200);
    assert.equal((await res2.text()).includes('OmniFlow SPA'), true);
  });

  test('GET /unknown-route returns 404 Not Found', async () => {
    const req = new Request('http://localhost/non-existent');
    const res = await honoApp.fetch(req);

    assert.equal(res.status, 404);
    const data = await res.json() as { error: string };
    assert.equal(data.error, 'Not Found');
  });

  test('Global Security Headers are present', async () => {
    const req = new Request('http://localhost/health');
    const res = await honoApp.fetch(req);

    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });
});
