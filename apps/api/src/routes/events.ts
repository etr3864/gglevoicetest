import { Router } from 'express';
import { authMiddlewareOptionalToken } from '../middleware/auth';
import { sseManager } from '../services/events/sse.manager';

const router = Router();

router.get('/agents/:id/events', authMiddlewareOptionalToken, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseManager.addClient(req.params.id, res);
});

export default router;
