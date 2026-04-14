import { Router } from 'express';
import { prisma, Prisma } from '@voice/db';
import { AppError } from '../middleware/error-handler';
import { authMiddleware, requireSuperAdmin, assertAgentAccess } from '../middleware/auth';
import {
  buildOAuthUrl,
  exchangeCodeForTokens,
  getPrimaryCalendarId,
  getValidToken,
} from '../services/calendar/google';
import type { CalendarConfig } from '@voice/shared';

const router = Router();

router.get('/:id/calendar/connect', authMiddleware, requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const agent = await prisma.agent.findUnique({ where: { id } });
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
  const calendarId = await getPrimaryCalendarId(tokens.accessToken);

  const config: CalendarConfig = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    calendarId,
  };

  await prisma.agent.update({
    where: { id: agentId },
    data: { calendarConfig: config as any },
  });

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  res.redirect(`${frontendUrl}/agents/${agentId}?tab=calendar&connected=true`);
});

router.post('/:id/calendar/disconnect', authMiddleware, requireSuperAdmin, async (req, res) => {
  const { id } = req.params as { id: string };
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  await prisma.agent.update({
    where: { id },
    data: { calendarConfig: Prisma.DbNull },
  });

  res.json({ data: { disconnected: true } });
});

router.get('/:id/calendar/status', authMiddleware, async (req, res) => {
  const { id } = req.params as { id: string };
  await assertAgentAccess(id, req.user!);
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  const connected = !!agent.calendarConfig;
  const config = agent.calendarConfig as unknown as CalendarConfig | null;
  res.json({
    data: {
      connected,
      calendarId: config?.calendarId ?? null,
      calendars: [],
    },
  });
});

export default router;
