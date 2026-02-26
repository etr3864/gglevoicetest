import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@voice/db';
import type { JwtPayload } from '@voice/shared';
import { AppError } from '../middleware/error-handler';

const router = Router();
const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

function getSecrets() {
  return {
    jwt: process.env.JWT_SECRET || 'dev-secret',
    refresh: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
  };
}

function signTokens(user: { id: string; email: string; role: string }) {
  const secrets = getSecrets();
  const payload: JwtPayload = { userId: user.id, email: user.email, role: user.role };
  const accessToken = jwt.sign(payload, secrets.jwt, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign(payload, secrets.refresh, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError(400, 'INVALID_INPUT', 'Email and password required');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');

  const tokens = signTokens(user);
  res.json({ data: tokens });
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError(400, 'INVALID_INPUT', 'Refresh token required');

  try {
    const payload = jwt.verify(refreshToken, getSecrets().refresh) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'User not found');

    const tokens = signTokens(user);
    res.json({ data: tokens });
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid refresh token');
  }
});

export default router;
