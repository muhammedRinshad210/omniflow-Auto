import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sendWhatsAppTextMessage } from '../apps/api/src/adapters/whatsapp/client.ts';
import { mapMetaErrorCode, VERIFIED_META_ERRORS } from '../apps/api/src/adapters/whatsapp/errors.ts';

describe('Meta WhatsApp Client & Error Mapping Tests', () => {
  test('Successful outbound text message captures provider message ID', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          messaging_product: 'whatsapp',
          contacts: [{ input: '919876543210', wa_id: '919876543210' }],
          messages: [{ id: 'wamid.HBgTESTMESSAGEID12345' }]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const result = await sendWhatsAppTextMessage({
      phoneNumberId: '10987654321',
      accessToken: 'test_token',
      toWaId: '919876543210',
      text: 'Test reply',
      fetchFn: mockFetch
    });

    assert.equal(result.success, true);
    assert.equal(result.messageId, 'wamid.HBgTESTMESSAGEID12345');
  });

  test('Error 190 maps to plain-language token expiration with official citation', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Error validating access token: Session has expired',
            type: 'OAuthException',
            code: 190
          }
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const result = await sendWhatsAppTextMessage({
      phoneNumberId: '10987654321',
      accessToken: 'expired_token',
      toWaId: '919876543210',
      text: 'Hello',
      fetchFn: mockFetch
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 190);
    assert.ok(result.errorMessage?.includes('expired or is invalid'));
    assert.equal(VERIFIED_META_ERRORS[190].isVerified, true);
  });

  test('Error 131047 maps to 24-hour customer care window explanation', async () => {
    const mockFetch: typeof fetch = async () => {
      return new Response(
        JSON.stringify({
          error: {
            message: 'Message failed to send because more than 24 hours have passed since the customer last replied',
            code: 131047,
            error_data: { details: 'Re-engagement message' }
          }
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    };

    const result = await sendWhatsAppTextMessage({
      phoneNumberId: '10987654321',
      accessToken: 'token',
      toWaId: '919876543210',
      text: 'Hello',
      fetchFn: mockFetch
    });

    assert.equal(result.success, false);
    assert.equal(result.errorCode, 131047);
    assert.ok(result.errorMessage?.includes('Customer care window expired'));
    assert.equal(VERIFIED_META_ERRORS[131047].isVerified, true);
  });

  test('Unmapped Meta error code retains raw code and details in generic message', () => {
    const plain = mapMetaErrorCode(99999, 'Custom platform limit');
    assert.ok(plain.includes('99999'));
    assert.ok(plain.includes('Custom platform limit'));
  });
});
