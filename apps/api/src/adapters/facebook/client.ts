import { mapMetaErrorCode } from '../whatsapp/errors.ts';

export interface SendMessengerTextMessageParams {
  graphApiVersion?: string;
  pageId: string;
  accessToken: string;
  toPsid: string;
  text: string;
  fetchFn?: typeof fetch;
}

export interface SendMessengerResult {
  success: boolean;
  messageId?: string;
  errorCode?: number;
  errorMessage?: string;
}

/**
 * Meta Graph API Messenger (Facebook Page) Outbound Client
 * Endpoint: POST https://graph.facebook.com/{version}/me/messages
 * Requires a Page access token with pages_messaging permission.
 */
export async function sendMessengerTextMessage(
  params: SendMessengerTextMessageParams
): Promise<SendMessengerResult> {
  const version = params.graphApiVersion || 'v22.0';
  const url = `https://graph.facebook.com/${version}/me/messages`;
  const fetchImpl = params.fetchFn || fetch;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const payload = {
      recipient: { id: params.toPsid },
      messaging_type: 'RESPONSE',
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
      ? 'Request timed out after 10 seconds while contacting Facebook servers.'
      : (err instanceof Error ? err.message : 'Network error contacting Facebook servers');

    return { success: false, errorMessage: message };
  }
}
