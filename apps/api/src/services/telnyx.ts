import { createLogger } from '../lib/logger';
import { buildAnswerParams, buildDialStreamParams, TELNYX_SIP, getStreamUrl } from '../lib/audio-config';

const log = createLogger('telnyx');
const BASE_URL = 'https://api.telnyx.com/v2';
const DEFAULT_TIMEOUT_MS = 8_000;

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY not set');
  return key;
}

async function telnyxGet(path: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Authorization': `Bearer ${getApiKey()}` },
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
      throw new Error(`Telnyx API timeout after ${timeoutMs}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
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

export async function answerCall(callControlId: string, streamUrl: string): Promise<void> {
  await telnyxPost(`/calls/${callControlId}/actions/answer`, buildAnswerParams(streamUrl));
}

export async function startStream(callControlId: string, streamUrl: string): Promise<void> {
  await telnyxPost(`/calls/${callControlId}/actions/streaming_start`, buildAnswerParams(streamUrl));
}

export async function hangupCall(callControlId: string): Promise<void> {
  try {
    await telnyxPost(`/calls/${callControlId}/actions/hangup`, {});
  } catch {
    // Call may already be ended
  }
}

export async function startRecording(callControlId: string): Promise<void> {
  await telnyxPost(`/calls/${callControlId}/actions/record_start`, {
    format: 'mp3',
    channels: 'single',
  });
}

export async function fetchRecordingByCallControlId(callControlId: string): Promise<{
  id: string;
  download_urls: { mp3: string };
  duration_millis: number;
} | null> {
  try {
    const res = await telnyxGet(`/recordings?filter[call_control_id]=${callControlId}&page[size]=1`);
    const rec = res?.data?.[0];
    if (!rec) return null;
    return { id: rec.id, download_urls: rec.download_urls, duration_millis: rec.duration_millis };
  } catch {
    return null;
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
  const streamUrl = getStreamUrl();

  const res = await telnyxPost('/calls', {
    connection_id: params.connectionId,
    from: params.from,
    from_display_name: params.fromDisplayName || 'Optive',
    to: params.to,
    webhook_url: params.webhookUrl,
    webhook_url_method: 'POST',
    timeout_secs: 60,
    preferred_codecs: TELNYX_SIP.preferredCodecs,
    answering_machine_detection: 'disabled',
    client_state: params.clientState
      ? Buffer.from(params.clientState).toString('base64')
      : undefined,
    ...buildDialStreamParams(streamUrl)
  });

  return {
    callControlId: res.data.call_control_id,
    callLegId: res.data.call_leg_id,
  };
}
