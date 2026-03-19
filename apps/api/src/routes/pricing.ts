import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@voice/db';
import { requireSuperAdmin } from '../middleware/auth';

const router = Router();

const SINGLETON_ID = 'singleton';

const updateSchema = z.object({
  geminiAudioInputPer1M: z.number().min(0).optional(),
  geminiAudioOutputPer1M: z.number().min(0).optional(),
  geminiTextInputPer1M: z.number().min(0).optional(),
  geminiTextOutputPer1M: z.number().min(0).optional(),
  geminiSummaryPer1M: z.number().min(0).optional(),
  telnyxCallPerMin: z.number().min(0).optional(),
  telnyxRecordingPerMin: z.number().min(0).optional(),
  deepgramPerSec: z.number().min(0).optional(),
  usdToIls: z.number().min(0).optional(),
});

router.get('/', requireSuperAdmin, async (_req, res) => {
  const config = await prisma.pricingConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
  res.json({ data: config });
});

router.put('/', requireSuperAdmin, async (req, res) => {
  const data = updateSchema.parse(req.body);
  const config = await prisma.pricingConfig.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  res.json({ data: config });
});

export default router;
