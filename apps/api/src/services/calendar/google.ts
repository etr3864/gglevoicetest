import { prisma } from '@voice/db';
import { createLogger } from '../../lib/logger';
import type { CalendarConfig } from '@voice/shared';

const log = createLogger('google-calendar');

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const API_TIMEOUT_MS = 8_000;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export const TIMEZONE = 'Asia/Jerusalem';

function getClientCredentials() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, or GOOGLE_REDIRECT_URI');
  }
  return { clientId, clientSecret, redirectUri };
}

export function buildOAuthUrl(agentId: string): string {
  const { clientId, redirectUri } = getClientCredentials();
  const scopes = 'https://www.googleapis.com/auth/calendar';
  const state = agentId;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const { clientId, clientSecret, redirectUri } = getClientCredentials();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const data = await googlePost(GOOGLE_TOKEN_URL, body);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function getValidToken(agentId: string): Promise<{ token: string; calendarId: string }> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent?.calendarConfig) throw new Error('Agent has no calendar connected');

  const config = agent.calendarConfig as unknown as CalendarConfig;
  if (Date.now() < config.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return { token: config.accessToken, calendarId: config.calendarId };
  }

  const refreshed = await refreshAccessToken(config.refreshToken);
  const updated: CalendarConfig = {
    ...config,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  };
  await prisma.agent.update({
    where: { id: agentId },
    data: { calendarConfig: updated as any },
  });

  return { token: updated.accessToken, calendarId: updated.calendarId };
}

export interface FreeBusySlot {
  start: string;
  end: string;
}

export async function getFreeBusy(
  token: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<FreeBusySlot[]> {
  const data = await googleFetch(token, '/freeBusy', {
    method: 'POST',
    body: JSON.stringify({
      timeMin,
      timeMax,
      timeZone: TIMEZONE,
      items: [{ id: calendarId }],
    }),
  });

  return data.calendars?.[calendarId]?.busy ?? [];
}

export interface CalendarEvent {
  summary: string;
  description?: string;
  start: string;
  end: string;
  attendeePhone?: string;
  attendeeName?: string;
}

export async function createEvent(
  token: string,
  calendarId: string,
  event: CalendarEvent,
): Promise<{ eventId: string; htmlLink: string }> {
  const data = await googleFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body: JSON.stringify({
      summary: event.summary,
      description: buildEventDescription(event),
      start: { dateTime: event.start, timeZone: TIMEZONE },
      end: { dateTime: event.end, timeZone: TIMEZONE },
    }),
  });

  return { eventId: data.id, htmlLink: data.htmlLink };
}

export async function updateEvent(
  token: string,
  calendarId: string,
  eventId: string,
  update: { start?: string; end?: string; summary?: string },
): Promise<void> {
  const body: Record<string, unknown> = {};
  if (update.summary) body.summary = update.summary;
  if (update.start) body.start = { dateTime: update.start, timeZone: TIMEZONE };
  if (update.end) body.end = { dateTime: update.end, timeZone: TIMEZONE };

  await googleFetch(token, `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteEvent(
  token: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const url = `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`;

  try {
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok && res.status !== 410) {
      const text = await res.text();
      log.error('Google Calendar delete error', undefined, { status: res.status });
      throw new Error(`Google Calendar API ${res.status}: ${text}`);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Google Calendar API timeout: DELETE event');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface CalendarListEntry {
  id: string;
  summary: string;
  primary: boolean;
}

export async function listCalendars(token: string): Promise<CalendarListEntry[]> {
  const data = await googleFetch(token, '/users/me/calendarList', { method: 'GET' });
  return (data.items ?? []).map((item: any) => ({
    id: item.id,
    summary: item.summary,
    primary: item.primary ?? false,
  }));
}

// --- Internal ---

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const { clientId, clientSecret } = getClientCredentials();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const data = await googlePost(GOOGLE_TOKEN_URL, body);
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

async function googlePost(url: string, body: URLSearchParams): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      log.error('Google token API error', undefined, { status: res.status });
      throw new Error(`Google OAuth ${res.status}: ${text}`);
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Google OAuth API timeout');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function googleFetch(token: string, path: string, init: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const url = path.startsWith('http') ? path : `${GOOGLE_CALENDAR_BASE}${path}`;

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      log.error('Google Calendar API error', undefined, { status: res.status, path });
      throw new Error(`Google Calendar API ${res.status}: ${text}`);
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Google Calendar API timeout: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function buildEventDescription(event: CalendarEvent): string {
  const parts: string[] = [];
  if (event.description) parts.push(event.description);
  if (event.attendeeName) parts.push(`Contact: ${event.attendeeName}`);
  if (event.attendeePhone) parts.push(`Phone: ${event.attendeePhone}`);
  return parts.join('\n');
}
