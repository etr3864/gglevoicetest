import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '@voice/db';
import type { JwtPayload, UserRole } from '@voice/shared';
import {
  createAdminSchema,
  createEmployeeSchema,
  createSuperAdminSchema,
  updateAdminSchema,
  updateEmployeeSchema,
  changePasswordSchema,
  resetPasswordSchema,
} from '@voice/shared';
import { AppError } from '../middleware/error-handler';
import { authMiddleware, requireSuperAdmin, requireAdminOrAbove } from '../middleware/auth';
import { redis } from '../lib/redis';
import { createLogger } from '../lib/logger';

const log = createLogger('auth');
const router = Router();

const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';
const BCRYPT_ROUNDS = 12;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_SECONDS = 900;

function getSecrets() {
  const jwtSecret = process.env.JWT_SECRET;
  const refreshSecret = process.env.JWT_REFRESH_SECRET;
  if (!jwtSecret || jwtSecret === 'dev-secret') throw new Error('JWT_SECRET must be set');
  if (!refreshSecret || refreshSecret === 'dev-refresh-secret') throw new Error('JWT_REFRESH_SECRET must be set');
  return { jwt: jwtSecret, refresh: refreshSecret };
}

function signTokens(user: { id: string; email: string; role: string; isActive: boolean; parentId: string | null }) {
  const secrets = getSecrets();
  const payload: Omit<JwtPayload, 'exp' | 'iat'> = {
    userId: user.id,
    email: user.email,
    role: user.role as UserRole,
    isActive: user.isActive,
    parentId: user.parentId,
  };
  const accessToken = jwt.sign(payload, secrets.jwt, { expiresIn: ACCESS_TTL });
  const refreshToken = jwt.sign(payload, secrets.refresh, { expiresIn: REFRESH_TTL });
  return { accessToken, refreshToken };
}

function sanitizeUser(user: { id: string; email: string; role: string; name: string | null; companyName: string | null; phone: string | null; isActive: boolean; parentId: string | null; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    companyName: user.companyName,
    phone: user.phone,
    isActive: user.isActive,
    parentId: user.parentId,
    createdAt: user.createdAt.toISOString(),
  };
}

// ─── Login ───

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rateKey = `login_fail:${ip}`;

  const attempts = parseInt(await redis.get(rateKey) || '0');
  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    log.warn('Login rate limited', { ip });
    throw new AppError(429, 'RATE_LIMITED', 'Too many login attempts. Try again later.');
  }

  const { email, password } = req.body;
  if (!email || !password) throw new AppError(400, 'INVALID_INPUT', 'Email and password required');

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !await bcrypt.compare(password, user.password)) {
    await redis.incr(rateKey);
    await redis.expire(rateKey, LOGIN_BLOCK_SECONDS);
    log.warn('Login failed', { email, ip });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  if (!user.isActive) {
    log.warn('Login blocked: inactive user', { email, ip });
    throw new AppError(401, 'ACCOUNT_DISABLED', 'Account is deactivated');
  }

  await redis.del(rateKey);
  const tokens = signTokens(user);
  log.info('Login successful', { email, role: user.role, ip });
  res.json({ data: { ...tokens, user: sanitizeUser(user) } });
});

router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError(400, 'INVALID_INPUT', 'Refresh token required');

  try {
    const payload = jwt.verify(refreshToken, getSecrets().refresh) as JwtPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'User not found');
    if (!user.isActive) throw new AppError(401, 'ACCOUNT_DISABLED', 'Account is deactivated');

    const tokens = signTokens(user);
    res.json({ data: { ...tokens, user: sanitizeUser(user) } });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(401, 'UNAUTHORIZED', 'Invalid refresh token');
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');
  res.json({ data: sanitizeUser(user) });
});

router.put('/me/password', authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) throw new AppError(404, 'NOT_FOUND', 'User not found');

  if (!await bcrypt.compare(currentPassword, user.password)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) },
  });
  res.json({ data: { success: true } });
});

// ─── Super Admins (only super_admin can manage) ───

router.get('/super-admins', authMiddleware, requireSuperAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { role: 'super_admin' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, name: true, role: true, isActive: true, parentId: true, companyName: true, phone: true, createdAt: true },
  });
  res.json({ data: users.map(u => ({ ...u, createdAt: u.createdAt.toISOString() })) });
});

router.post('/super-admins', authMiddleware, requireSuperAdmin, async (req, res) => {
  const body = createSuperAdminSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new AppError(409, 'EMAIL_EXISTS', 'Email already in use');

  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: await bcrypt.hash(body.password, BCRYPT_ROUNDS),
      name: body.name,
      role: 'super_admin',
    },
  });
  log.info('Super admin created', { actorId: req.user!.userId, targetEmail: user.email });
  res.status(201).json({ data: sanitizeUser(user) });
});

router.delete('/super-admins/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  const id = req.params.id as string;
  if (id === req.user!.userId) throw new AppError(400, 'SELF_DELETE', 'Cannot delete your own account');
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target || target.role !== 'super_admin') throw new AppError(404, 'NOT_FOUND', 'Super admin not found');
  await prisma.user.delete({ where: { id } });
  log.info('Super admin deleted', { actorId: req.user!.userId, targetEmail: target.email });
  res.json({ data: { success: true } });
});

// ─── Admins (only super_admin can manage) ───

router.get('/admins', authMiddleware, requireSuperAdmin, async (_req, res) => {
  const admins = await prisma.user.findMany({
    where: { role: 'admin' },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { agents: true } } },
  });
  res.json({ data: admins.map(a => ({ ...sanitizeUser(a), _count: a._count })) });
});

router.post('/admins', authMiddleware, requireSuperAdmin, async (req, res) => {
  const body = createAdminSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new AppError(409, 'EMAIL_EXISTS', 'Email already in use');

  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: await bcrypt.hash(body.password, BCRYPT_ROUNDS),
      name: body.name,
      companyName: body.companyName,
      phone: body.phone,
      role: 'admin',
    },
  });
  log.info('Admin created', { actorId: req.user!.userId, targetEmail: user.email });
  res.status(201).json({ data: sanitizeUser(user) });
});

router.put('/admins/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  const body = updateAdminSchema.parse(req.body);
  const user = await prisma.user.update({ where: { id: req.params.id as string }, data: body });
  res.json({ data: sanitizeUser(user) });
});

router.delete('/admins/:id', authMiddleware, requireSuperAdmin, async (req, res) => {
  const id = req.params.id as string;
  const admin = await prisma.user.findUnique({ where: { id } });
  if (!admin) throw new AppError(404, 'NOT_FOUND', 'Admin not found');
  const agentCount = await prisma.agent.count({ where: { userId: id } });
  if (agentCount > 0) {
    throw new AppError(400, 'HAS_AGENTS', 'Cannot delete admin with assigned agents. Remove agents first.');
  }

  await prisma.user.deleteMany({ where: { parentId: id } });
  await prisma.user.delete({ where: { id } });
  log.info('Admin deleted', { actorId: req.user!.userId, targetEmail: admin.email });
  res.json({ data: { success: true } });
});

router.put('/admins/:id/password', authMiddleware, requireSuperAdmin, async (req, res) => {
  const { password } = resetPasswordSchema.parse(req.body);
  await prisma.user.update({
    where: { id: req.params.id as string },
    data: { password: await bcrypt.hash(password, BCRYPT_ROUNDS) },
  });
  res.json({ data: { success: true } });
});

// ─── Agent assignment (only super_admin) ───

router.get('/admins/:adminId/agents', authMiddleware, requireSuperAdmin, async (req, res) => {
  const adminId = req.params.adminId as string;
  const agents = await prisma.agent.findMany({
    where: { userId: adminId },
    select: { id: true, name: true, phoneNumber: true, status: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: agents });
});

router.post('/admins/:adminId/agents/:agentId', authMiddleware, requireSuperAdmin, async (req, res) => {
  const adminId = req.params.adminId as string;
  const agentId = req.params.agentId as string;
  await prisma.agent.update({
    where: { id: agentId },
    data: { userId: adminId },
  });
  res.json({ data: { success: true } });
});

router.delete('/admins/:adminId/agents/:agentId', authMiddleware, requireSuperAdmin, async (req, res) => {
  const adminId = req.params.adminId as string;
  const agentId = req.params.agentId as string;
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.userId !== adminId) {
    throw new AppError(404, 'NOT_FOUND', 'Agent not assigned to this admin');
  }
  await prisma.agent.update({
    where: { id: agentId },
    data: { userId: null },
  });
  res.json({ data: { success: true } });
});

router.get('/agents/unassigned', authMiddleware, requireSuperAdmin, async (_req, res) => {
  const agents = await prisma.agent.findMany({
    where: { userId: null },
    select: { id: true, name: true, phoneNumber: true, status: true },
  });
  res.json({ data: agents });
});

// ─── Employees (admin+ can manage own employees) ───

router.get('/employees', authMiddleware, requireAdminOrAbove, async (req, res) => {
  const isSuperAdmin = req.user!.role === 'super_admin';

  if (isSuperAdmin) {
    const employees = await prisma.user.findMany({
      where: { role: 'employee' },
      orderBy: { createdAt: 'desc' },
      include: { parent: { select: { id: true, name: true, companyName: true, email: true } } },
    });
    res.json({
      data: employees.map((e) => ({
        ...sanitizeUser(e),
        parentName: e.parent ? (e.parent.name || e.parent.companyName || e.parent.email) : null,
      })),
    });
    return;
  }

  const employees = await prisma.user.findMany({
    where: { role: 'employee', parentId: req.user!.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ data: employees.map(sanitizeUser) });
});

router.post('/employees', authMiddleware, requireAdminOrAbove, async (req, res) => {
  const body = createEmployeeSchema.parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: body.email } });
  if (exists) throw new AppError(409, 'EMAIL_EXISTS', 'Email already in use');

  const parentId = req.user!.role === 'super_admin' ? req.user!.userId : req.user!.userId;
  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: await bcrypt.hash(body.password, BCRYPT_ROUNDS),
      name: body.name,
      role: 'employee',
      parentId,
    },
  });
  log.info('Employee created', { actorId: req.user!.userId, targetEmail: user.email });
  res.status(201).json({ data: sanitizeUser(user) });
});

async function assertEmployeeOwnership(employeeId: string, user: JwtPayload) {
  const employee = await prisma.user.findUnique({ where: { id: employeeId } });
  if (!employee || employee.role !== 'employee') {
    throw new AppError(404, 'NOT_FOUND', 'Employee not found');
  }
  if (user.role !== 'super_admin' && employee.parentId !== user.userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }
  return employee;
}

router.put('/employees/:id', authMiddleware, requireAdminOrAbove, async (req, res) => {
  const id = req.params.id as string;
  await assertEmployeeOwnership(id, req.user!);
  const body = updateEmployeeSchema.parse(req.body);
  const user = await prisma.user.update({ where: { id }, data: body });
  res.json({ data: sanitizeUser(user) });
});

router.delete('/employees/:id', authMiddleware, requireAdminOrAbove, async (req, res) => {
  const id = req.params.id as string;
  const employee = await assertEmployeeOwnership(id, req.user!);
  await prisma.user.delete({ where: { id: employee.id } });
  log.info('Employee deleted', { actorId: req.user!.userId, targetEmail: employee.email });
  res.json({ data: { success: true } });
});

router.put('/employees/:id/password', authMiddleware, requireAdminOrAbove, async (req, res) => {
  const id = req.params.id as string;
  await assertEmployeeOwnership(id, req.user!);
  const { password } = resetPasswordSchema.parse(req.body);
  await prisma.user.update({
    where: { id },
    data: { password: await bcrypt.hash(password, BCRYPT_ROUNDS) },
  });
  res.json({ data: { success: true } });
});

export default router;
