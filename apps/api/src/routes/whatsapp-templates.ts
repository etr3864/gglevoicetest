import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import { prisma } from '@voice/db';
import { requireSuperAdmin, assertAgentAccess } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';
import { decryptConfig } from '../services/whatsapp/config-crypto';
import { syncTemplates, createTemplate, deleteTemplate, uploadTemplateMedia } from '../services/whatsapp/template.service';
import type { MetaConfig } from '../services/whatsapp/providers/types';

const router = Router({ mergeParams: true });

const upload = multer({
  dest: '/tmp/template-uploads',
  limits: { fileSize: 100 * 1024 * 1024 },
});

async function getMetaConfig(agentId: string): Promise<MetaConfig> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { whatsappProvider: true, whatsappConfig: true },
  });
  if (!agent?.whatsappConfig) throw new AppError(400, 'NO_WHATSAPP_CONFIG', 'אין הגדרות WhatsApp לסוכן זה');
  if (agent.whatsappProvider !== 'meta') throw new AppError(400, 'NOT_META_PROVIDER', 'הסוכן לא משתמש ב-Meta');
  return decryptConfig(agent.whatsappConfig) as MetaConfig;
}

router.get('/whatsapp/templates', requireSuperAdmin, async (req, res) => {
  const { agentId } = req.params as { agentId: string };
  await assertAgentAccess(agentId, req.user!);

  const page = Math.max(1, parseInt(String(req.query.page ?? '1')));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'))));
  const status = req.query.status as string | undefined;

  const where = { agentId, ...(status && status !== 'ALL' ? { status } : {}) };
  const [templates, total] = await Promise.all([
    prisma.whatsappTemplate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.whatsappTemplate.count({ where }),
  ]);

  res.json({ data: templates, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
});

router.post('/whatsapp/templates/sync', requireSuperAdmin, async (req, res) => {
  const { agentId } = req.params as { agentId: string };
  await assertAgentAccess(agentId, req.user!);
  const config = await getMetaConfig(agentId);
  await syncTemplates(agentId, config);
  res.json({ data: { success: true } });
});

router.post('/whatsapp/templates', requireSuperAdmin, async (req, res) => {
  const { agentId } = req.params as { agentId: string };
  await assertAgentAccess(agentId, req.user!);
  const config = await getMetaConfig(agentId);

  const { name, language, category, components } = req.body as {
    name: string;
    language: string;
    category: string;
    components: unknown[];
  };

  if (!name || !language || !category || !Array.isArray(components)) {
    throw new AppError(400, 'INVALID_INPUT', 'name, language, category, components הם שדות חובה');
  }

  const result = await createTemplate(agentId, config, { name, language, category, components });
  res.status(201).json({ data: result });
});

router.delete('/whatsapp/templates/:templateId', requireSuperAdmin, async (req, res) => {
  const { agentId, templateId } = req.params as { agentId: string; templateId: string };
  await assertAgentAccess(agentId, req.user!);
  const config = await getMetaConfig(agentId);
  await deleteTemplate(agentId, templateId, config);
  res.json({ data: { success: true } });
});

router.post('/whatsapp/templates/media', requireSuperAdmin, upload.single('file'), async (req, res) => {
  const { agentId } = req.params as { agentId: string };
  await assertAgentAccess(agentId, req.user!);

  if (!req.file) throw new AppError(400, 'NO_FILE', 'לא הועלה קובץ');

  const config = await getMetaConfig(agentId);

  try {
    const mediaId = await uploadTemplateMedia(
      config,
      req.file.path,
      req.file.mimetype,
      req.file.size,
    );
    res.json({ data: { mediaId } });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

export default router;
