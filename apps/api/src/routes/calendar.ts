import { Router } from 'express';
import { prisma, Prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import {
  buildOAuthUrl,
  exchangeCodeForTokens,
  getValidToken,
  listCalendars,
} from '../services/calendar/google';
import type { CalendarConfig } from '@voice/shared';

const router = Router();

router.get('/:id/calendar/connect', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  const url = buildOAuthUrl(agent.id);
  res.json({ data: { url } });
});

router.get('/calendar/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    throw new AppError(400, 'INVALID_INPUT', 'Missing authorization code or agent state');
  }

  const agentId = state;
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  const tokens = await exchangeCodeForTokens(code);
  const calendars = await listCalendars(tokens.accessToken);
  const primary = calendars.find(c => c.primary) ?? calendars[0];
  if (!primary) throw new AppError(400, 'NO_CALENDAR', 'No Google Calendar found');

  const config: CalendarConfig = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    calendarId: primary.id,
  };

  await prisma.agent.update({
    where: { id: agentId },
    data: { calendarConfig: config as any },
  });

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(`${frontendUrl}/agents/${agentId}?tab=calendar&connected=true`);
});

router.post('/:id/calendar/disconnect', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  await prisma.agent.update({
    where: { id: req.params.id },
    data: { calendarConfig: Prisma.DbNull },
  });

  res.json({ data: { disconnected: true } });
});

router.get('/:id/calendar/status', async (req, res) => {
  const agent = await prisma.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  const connected = !!agent.calendarConfig;
  let calendars: { id: string; summary: string; primary: boolean }[] = [];

  if (connected) {
    try {
      const { token } = await getValidToken(agent.id);
      calendars = await listCalendars(token);
    } catch {
      // Token might be invalid — still report connected but no calendars
    }
  }

  const config = agent.calendarConfig as unknown as CalendarConfig | null;
  res.json({
    data: {
      connected,
      calendarId: config?.calendarId ?? null,
      calendars,
    },
  });
});

export default router;
