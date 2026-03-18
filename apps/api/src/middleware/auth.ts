import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@voice/db';
import type { JwtPayload } from '@voice/shared';
import { AppError } from './error-handler';
import { createLogger } from '../lib/logger';

const log = createLogger('auth');

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'dev-secret') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return secret;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid token');
  }

  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
    if (payload.isActive === false) {
      throw new AppError(401, 'UNAUTHORIZED', 'Account deactivated');
    }
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

export function authMiddlewareOptionalToken(req: Request, _res: Response, next: NextFunction) {
  const token =
    (req.query.token as string) ||
    (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) {
    throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid token');
  }
  try {
    const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
    if (payload.isActive === false) {
      throw new AppError(401, 'UNAUTHORIZED', 'Account deactivated');
    }
    req.user = payload;
    next();
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token');
  }
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'super_admin') {
    log.warn('Forbidden: super_admin required', {
      userId: req.user?.userId,
      role: req.user?.role,
      path: req.originalUrl,
    });
    throw new AppError(403, 'FORBIDDEN', 'Super admin access required');
  }
  next();
}

export function requireAdminOrAbove(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role === 'employee') {
    log.warn('Forbidden: admin or above required', {
      userId: req.user?.userId,
      path: req.originalUrl,
    });
    throw new AppError(403, 'FORBIDDEN', 'Admin access required');
  }
  next();
}

function getAdminId(user: JwtPayload): string {
  return user.role === 'employee' && user.parentId ? user.parentId : user.userId;
}

export async function assertAgentAccess(agentId: string, user: JwtPayload): Promise<void> {
  if (user.role === 'super_admin') return;

  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { userId: true },
  });
  if (!agent) throw new AppError(404, 'NOT_FOUND', 'Agent not found');

  const adminId = getAdminId(user);
  if (agent.userId !== adminId) {
    log.warn('Forbidden: agent access denied', {
      userId: user.userId,
      agentId,
      agentOwner: agent.userId,
    });
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }
}
