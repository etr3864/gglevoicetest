import { Request, Response, NextFunction } from 'express';
import { prisma } from '@voice/db';
import { AppError } from './error-handler';

declare global {
  namespace Express {
    interface Request {
      agent?: { id: string; name: string; status: string; phoneNumber: string | null };
    }
  }
}

export async function apikeyMiddleware(req: Request, _res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'] as string;
  if (!key) throw new AppError(401, 'UNAUTHORIZED', 'API key required');

  const agent = await prisma.agent.findUnique({
    where: { apiKey: key },
    select: { id: true, name: true, status: true, phoneNumber: true },
  });

  if (!agent) throw new AppError(401, 'UNAUTHORIZED', 'Invalid API key');
  if (agent.status !== 'active') throw new AppError(403, 'AGENT_INACTIVE', 'Agent is not active');

  req.agent = agent;
  next();
}
