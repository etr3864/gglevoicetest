import { createLogger } from '../lib/logger';
import { buildAnswerParams, buildDialStreamParams, TELNYX_SIP, getStreamUrl } from '../lib/audio-config';

const log = createLogger('telnyx');
const BASE_URL = 'https://api.telnyx.com/v2';
const DEFAULT_TIMEOUT_MS = 8_000;

// Israeli carriers interconnect via European IXPs — routing through US adds latency and increases carrier rejection risk
const SIP_REGION = (process.env.TELNYX_SIP_REGION || 'Europe') as 'US' | 'Europe' | 'Canada' | 'Australia' | 'Middle East';

// Warmup can take up to ~6.7s — 60s gives enough time before treating no-answer as a timeout
const OUTBOUND_RING_TIMEOUT_SECS = 60;

const DEFAULT_DISPLAY_NAME = process.env.TELNYX_DISPLAY_NAME || 'Optive';

// --- Telnyx API response shapes ---

interface TelnyxDialResponse {
  data: {
    call_control_id: string;
    call_leg_id: string;
  };
}

interface TelnyxRecordingItem {
  id: string;
  download_urls: { mp3: string };
  duration_millis: number;
}

// ---

function getApiKey(): string {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error('TELNYX_API_KEY not set');
  return key;
}

async function telnyxFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      log.error('API error', undefined, { status: res.status, path, ms: Date.now() - t0 });
      throw new Error(`Telnyx API ${res.status}: ${text}`);
    }

    log.debug('Telnyx request', { method, path, ms: Date.now() - t0 });
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      log.error('API timeout', undefined, { path, timeoutMs, ms: Date.now() - t0 });
      throw new Error(`Telnyx API timeout after ${timeoutMs}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function answerCall(callControlId: string, streamUrl: string): Promise<void> {
  await telnyxFetch('POST', `/calls/${callControlId}/actions/answer`, {
    ...buildAnswerParams(streamUrl),
    command_id: `${callControlId}-answer`,
  });
}

export async function hangupCall(callControlId: string): Promise<void> {
  try {
    await telnyxFetch('POST', `/calls/${callControlId}/actions/hangup`, {
      command_id: `${callControlId}-hangup`,
    });
  } catch {
    log.warn('Hangup failed — call may already have ended', { callControlId: callControlId.slice(-12) });
  }
}

export async function startRecording(callControlId: string): Promise<void> {
  await telnyxFetch('POST', `/calls/${callControlId}/actions/record_start`, {
    format: 'mp3',
    channels: 'single',
    command_id: `${callControlId}-record`,
  });
}

export async function fetchRecordingByCallControlId(callControlId: string): Promise<{
  id: string;
  download_urls: { mp3: string };
  duration_millis: number;
} | null> {
  try {
    const res = await telnyxFetch('GET', `/recordings?filter[call_control_id]=${callControlId}&page[size]=1`);
    const rec = res?.data?.[0] as TelnyxRecordingItem | undefined;
    if (!rec) return null;
    return { id: rec.id, download_urls: rec.download_urls, duration_millis: rec.duration_millis };
  } catch {
    log.warn('Failed to fetch recording', { callControlId: callControlId.slice(-12) });
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
  if (!process.env.API_URL) {
    log.warn('API_URL not set — stream URL falls back to localhost, outbound calls will fail in production');
  }

  const streamUrl = getStreamUrl();

  const res = await telnyxFetch('POST', '/calls', {
    connection_id: params.connectionId,
    from: params.from,
    from_display_name: params.fromDisplayName || DEFAULT_DISPLAY_NAME,
    to: params.to,
    webhook_url: params.webhookUrl,
    webhook_url_method: 'POST',
    timeout_secs: OUTBOUND_RING_TIMEOUT_SECS,
    preferred_codecs: TELNYX_SIP.preferredCodecs,
    answering_machine_detection: 'disabled',
    sip_region: SIP_REGION,
    client_state: params.clientState
      ? Buffer.from(params.clientState).toString('base64')
      : undefined,
    ...buildDialStreamParams(streamUrl),
  }) as TelnyxDialResponse;

  return {
    callControlId: res.data.call_control_id,
    callLegId: res.data.call_leg_id,
  };
}
