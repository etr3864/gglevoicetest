import { createLogger } from '../lib/logger';

const log = createLogger('telnyx');
const BASE_URL = 'https://api.telnyx.com/v2';
const DEFAULT_TIMEOUT_MS = 8_000;

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY not set');
  return key;
}

async function telnyxPost(path: string, body: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      log.error('API error', undefined, { status: res.status, path });
      throw new Error(`Telnyx API ${res.status}: ${text}`);
    }

    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      log.error('API timeout', undefined, { path, timeoutMs });
      throw new Error(`Telnyx API timeout after ${timeoutMs}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function answerCall(callControlId: string): Promise<void> {
  await telnyxPost(`/calls/${callControlId}/actions/answer`, {
    preferred_codecs: 'G722',
  });
}

export async function startStream(callControlId: string, streamUrl: string): Promise<void> {
  await telnyxPost(`/calls/${callControlId}/actions/streaming_start`, {
    stream_url: streamUrl,
    stream_track: 'both_tracks',
    stream_codec: 'L16',
    stream_bidirectional_mode: 'rtp',
    stream_bidirectional_codec: 'L16',
    stream_bidirectional_sampling_rate: 24000,
  });
}

export async function hangupCall(callControlId: string): Promise<void> {
  try {
    await telnyxPost(`/calls/${callControlId}/actions/hangup`, {});
  } catch {
    // Call may already be ended
  }
}

export async function createOutboundCall(params: {
  from: string;
  to: string;
  connectionId: string;
  webhookUrl: string;
  clientState?: string;
  fromDisplayName?: string;
}): Promise<{ callControlId: string; callLegId: string }> {
  const res = await telnyxPost('/calls', {
    connection_id: params.connectionId,
    from: params.from,
    from_display_name: params.fromDisplayName || 'Optive',
    to: params.to,
    webhook_url: params.webhookUrl,
    webhook_url_method: 'POST',
    timeout_secs: 60,
    preferred_codecs: 'G722',
    answering_machine_detection: 'premium',
    client_state: params.clientState
      ? Buffer.from(params.clientState).toString('base64')
      : undefined,
  });

  return {
    callControlId: res.data.call_control_id,
    callLegId: res.data.call_leg_id,
  };
}
