import { Router } from 'express';
import { authMiddlewareOptionalToken } from '../middleware/auth';
import { sseManager } from '../services/events/sse.manager';

const router = Router();

router.get('/agents/:id/events', authMiddlewareOptionalToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const agentId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  sseManager.addClient(agentId, res);
});

export default router;
