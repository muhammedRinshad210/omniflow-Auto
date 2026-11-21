import { mapMetaErrorCode } from '../whatsapp/errors.ts';

export interface SendInstagramTextMessageParams {
  graphApiVersion?: string;
  instagramAccountId: string;
  accessToken: string;
  toIgsid: string;
  text: string;
  fetchFn?: typeof fetch;
}

export interface SendInstagramResult {
  success: boolean;
  messageId?: string;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Meta Graph API Instagram Messaging Outbound Client
 * Endpoint: POST https://graph.facebook.com/{version}/{ig-account-id}/messages
 * Requires an Instagram professional account linked to a Facebook Page and
 * instagram_basic + instagram_manage_messages permissions.
 */
export async function sendInstagramTextMessage(
  params: SendInstagramTextMessageParams
): Promise<SendInstagramResult> {
  const version = params.graphApiVersion || 'v22.0';
  const url = `https://graph.facebook.com/${version}/${params.instagramAccountId}/messages`;
  const fetchImpl = params.fetchFn || fetch;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const payload = {
      recipient: { id: params.toIgsid },
      message: { text: params.text }
    };

    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await res.json() as {
      message_id?: string;
      error?: {
        message?: string;
        code?: number;
        error_data?: { details?: string };
      };
    };

    if (res.ok && data.message_id) {
      return { success: true, messageId: data.message_id };
    }

    const code = data.error?.code;
    const details = data.error?.error_data?.details || data.error?.message;
    const plainError = mapMetaErrorCode(code, details);

    return { success: false, errorCode: code, errorMessage: plainError };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const message = isAbort
      ? 'Request timed out after 10 seconds while contacting Instagram servers.'
      : (err instanceof Error ? err.message : 'Network error contacting Instagram servers');

    return { success: false, errorMessage: message };
  }
}
