import { Router } from 'express';
import { authMiddleware, assertAgentAccess } from '../middleware/auth';
import { sseManager } from '../services/events/sse.manager';

const router = Router();

router.get('/agents/:id/events', authMiddleware, async (req, res) => {
  const { id } = req.params as { id: string };
  await assertAgentAccess(id, req.user!);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseManager.addClient(id, res);
});

export default router;
