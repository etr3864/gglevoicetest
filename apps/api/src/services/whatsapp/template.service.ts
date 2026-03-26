import fs from 'fs';
import { prisma } from '@voice/db';
import { AppError } from '../../middleware/error-handler';
import { createLogger } from '../../lib/logger';
import type { MetaConfig } from './providers/types';

const log = createLogger('template-service');

const META_BASE = 'https://graph.facebook.com/v22.0';

const ALLOWED_MIME_TYPES: Record<string, { maxBytes: number }> = {
  'image/jpeg':       { maxBytes: 5 * 1024 * 1024 },
  'image/png':        { maxBytes: 5 * 1024 * 1024 },
  'video/mp4':        { maxBytes: 16 * 1024 * 1024 },
  'application/pdf':  { maxBytes: 100 * 1024 * 1024 },
};

const META_ERROR_MESSAGES: Record<number, string> = {
  190: 'טוקן פג תוקף — צור System User Token חדש',
  100: 'פרמטר לא תקין',
  4:   'הגעת למגבלת קריאות Meta — נסה שוב מאוחר יותר',
  368: 'חשבון מושהה זמנית על ידי Meta',
};

function assertWabaConfig(config: MetaConfig): asserts config is MetaConfig & { wabaId: string } {
  if (!config.wabaId) throw new AppError(400, 'MISSING_WABA_ID', 'חסר WABA ID — הגדר אותו בטאב וואטסאפ');
}

function assertAppConfig(config: MetaConfig): asserts config is MetaConfig & { appId: string } {
  if (!config.appId) throw new AppError(400, 'MISSING_APP_ID', 'חסר App ID — הגדר אותו בטאב וואטסאפ');
}

function mapMetaError(status: number, code: number | undefined, fallback: string): AppError {
  if (status === 429 || code === 4) {
    return new AppError(429, 'META_RATE_LIMIT', META_ERROR_MESSAGES[4]);
  }
  const msg = (code !== undefined ? META_ERROR_MESSAGES[code] : undefined) ?? `${fallback} (קוד Meta ${code ?? status})`;
  return new AppError(400, 'META_API_ERROR', msg);
}

async function metaPost(url: string, body: unknown, accessToken: string): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return res.json();
  const err = await res.json().catch(() => ({})) as { error?: { code?: number; message?: string } };
  throw mapMetaError(res.status, err.error?.code, err.error?.message ?? 'שגיאה בקריאה ל-Meta');
}

async function metaDelete(url: string, accessToken: string): Promise<void> {
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { code?: number; message?: string } };
    throw mapMetaError(res.status, err.error?.code, err.error?.message ?? 'שגיאת מחיקה מ-Meta');
  }
}

async function fetchAllMetaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplateResponse[]> {
  const results: MetaTemplateResponse[] = [];
  let url: string | null = `${META_BASE}/${wabaId}/message_templates?fields=id,name,language,category,status,components,rejected_reason&limit=100&access_token=${accessToken}`;

  while (url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { code?: number; message?: string } };
      throw mapMetaError(res.status, err.error?.code, 'שגיאה בסנכרון תבניות');
    }
    const data = await res.json() as { data: MetaTemplateResponse[]; paging?: { next?: string } };
    results.push(...data.data);
    url = data.paging?.next ?? null;
  }

  return results;
}

export async function syncTemplates(agentId: string, config: MetaConfig): Promise<void> {
  assertWabaConfig(config);
  const metaTemplates = await fetchAllMetaTemplates(config.wabaId, config.accessToken);

  await prisma.$transaction(async (tx) => {
    for (const t of metaTemplates) {
      await tx.whatsappTemplate.upsert({
        where: { agentId_name_language: { agentId, name: t.name, language: t.language } },
        create: {
          agentId,
          metaId: t.id,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          rejectionReason: t.rejected_reason ?? null,
          components: t.components as object,
        },
        update: {
          metaId: t.id,
          status: t.status,
          rejectionReason: t.rejected_reason ?? null,
          components: t.components as object,
          category: t.category,
        },
      });
    }

    const metaKeys = new Set(metaTemplates.map(t => `${t.name}:${t.language}`));
    const local = await tx.whatsappTemplate.findMany({ where: { agentId }, select: { id: true, name: true, language: true } });
    const orphanIds = local.filter((l: { id: string; name: string; language: string }) => !metaKeys.has(`${l.name}:${l.language}`)).map((l: { id: string }) => l.id);
    if (orphanIds.length > 0) {
      await tx.whatsappTemplate.deleteMany({ where: { id: { in: orphanIds } } });
    }
  });
}

export async function createTemplate(
  agentId: string,
  config: MetaConfig,
  input: CreateTemplateInput,
): Promise<{ id: string; status: string }> {
  assertWabaConfig(config);

  const result = await metaPost(
    `${META_BASE}/${config.wabaId}/message_templates`,
    { name: input.name, language: input.language, category: input.category, components: input.components },
    config.accessToken,
  ) as { id: string; status: string };

  await prisma.whatsappTemplate.create({
    data: {
      agentId,
      metaId: result.id,
      name: input.name,
      language: input.language,
      category: input.category,
      status: result.status ?? 'PENDING',
      components: input.components as object,
    },
  });

  return result;
}

export async function deleteTemplate(agentId: string, templateId: string, config: MetaConfig): Promise<void> {
  assertWabaConfig(config);
  const tpl = await prisma.whatsappTemplate.findUnique({ where: { id: templateId } });
  if (!tpl || tpl.agentId !== agentId) throw new AppError(404, 'NOT_FOUND', 'תבנית לא נמצאה');

  await metaDelete(
    `${META_BASE}/${config.wabaId}/message_templates?name=${encodeURIComponent(tpl.name)}&hsm_id=${tpl.metaId}`,
    config.accessToken,
  );
  await prisma.whatsappTemplate.delete({ where: { id: templateId } });
}

export async function uploadTemplateMedia(
  config: MetaConfig,
  filePath: string,
  mimeType: string,
  fileSize: number,
): Promise<string> {
  assertAppConfig(config);

  const allowed = ALLOWED_MIME_TYPES[mimeType];
  if (!allowed) throw new AppError(400, 'INVALID_MIME', `סוג קובץ לא נתמך: ${mimeType}`);
  if (fileSize > allowed.maxBytes) {
    throw new AppError(400, 'FILE_TOO_LARGE', `הקובץ גדול מדי (מקסימום ${allowed.maxBytes / 1024 / 1024}MB)`);
  }

  // Step 1: start resumable upload session
  const sessionRes = await metaPost(
    `${META_BASE}/${config.appId}/uploads?file_length=${fileSize}&file_type=${encodeURIComponent(mimeType)}&access_token=${config.accessToken}`,
    {},
    config.accessToken,
  ) as { id: string };

  // Step 2: upload file bytes
  const fileBuffer = fs.readFileSync(filePath);
  const uploadRes = await fetch(`${META_BASE}/${sessionRes.id}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${config.accessToken}`,
      'Content-Type': mimeType,
      file_offset: '0',
    },
    body: fileBuffer,
    signal: AbortSignal.timeout(60_000),
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({})) as { error?: { code?: number; message?: string } };
    throw mapMetaError(uploadRes.status, err.error?.code, 'שגיאה בהעלאת קובץ ל-Meta');
  }

  const uploadData = await uploadRes.json() as { h: string };
  return uploadData.h;
}

// ─── Types ───

interface MetaTemplateResponse {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejected_reason?: string;
  components: unknown[];
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: string;
  components: unknown[];
}
