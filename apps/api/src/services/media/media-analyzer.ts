import { GoogleAuth } from 'google-auth-library';
import { createLogger } from '../../lib/logger';
import type { AnalysisContext, MediaAnalysisResult } from './types';

const log = createLogger('media:analyzer');

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const MEDIA_ANALYSIS_MODEL = process.env.MEDIA_ANALYSIS_MODEL || 'gemini-2.5-flash-lite';

function getEndpoint(): string {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  if (!project) throw new Error('GCP_PROJECT_ID missing');
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${MEDIA_ANALYSIS_MODEL}:generateContent`;
}

async function getAccessToken(): Promise<string> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Failed to get GCP access token');
  return token.token;
}

function buildSystemPrompt(context: AnalysisContext): string {
  const lines = [
    'אתה מנתח מדיה עבור סוכן AI עסקי.',
    '',
    'הקשר עסקי:',
    context.agentSystemPrompt.slice(0, 2000),
  ];

  if (context.analysisInstructions) {
    lines.push('', 'הנחיות נוספות:', context.analysisInstructions);
  }

  lines.push(
    '',
    'החזר JSON בדיוק בפורמט הבא:',
    '{"name":"שם קצר וברור (עד 50 תווים)","description":"תיאור מפורט לחיפוש סמנטי (100-200 תווים)","caption":"כיתוב ברירת מחדל לשליחה בווצאפ (50-100 תווים)"}',
    'הכל בעברית.',
  );

  return lines.join('\n');
}

async function callGemini(parts: object[], systemPrompt: string): Promise<{ text: string; tokenCount: number }> {
  const [accessToken, endpoint] = await Promise.all([getAccessToken(), Promise.resolve(getEndpoint())]);

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: 512, responseMimeType: 'application/json' },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini API ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as {
    candidates: [{ content: { parts: [{ text: string }] } }];
    usageMetadata: { totalTokenCount: number };
  };

  return {
    text: data.candidates[0]?.content?.parts[0]?.text ?? '{}',
    tokenCount: data.usageMetadata?.totalTokenCount ?? 0,
  };
}

function parseAnalysisJson(text: string, fallbackName: string): Omit<MediaAnalysisResult, 'tokenCount'> {
  try {
    const parsed = JSON.parse(text) as { name?: string; description?: string; caption?: string };
    return {
      name: String(parsed.name || fallbackName).slice(0, 100),
      description: String(parsed.description || '').slice(0, 500),
      caption: String(parsed.caption || '').slice(0, 300),
    };
  } catch {
    log.warn('Failed to parse analysis JSON', { text: text.slice(0, 100) });
    return { name: fallbackName, description: '', caption: '' };
  }
}

export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string,
  context: AnalysisContext,
  fallbackName: string,
): Promise<MediaAnalysisResult> {
  const systemPrompt = buildSystemPrompt(context);
  const base64 = imageBuffer.toString('base64');

  const parts = [
    { inlineData: { mimeType, data: base64 } },
    { text: 'נתח את התמונה הזו.' },
  ];

  const { text, tokenCount } = await callGemini(parts, systemPrompt);
  return { ...parseAnalysisJson(text, fallbackName), tokenCount };
}

export async function analyzeDocument(
  extractedText: string,
  context: AnalysisContext,
  fallbackName: string,
): Promise<MediaAnalysisResult> {
  const systemPrompt = buildSystemPrompt(context);
  const truncated = extractedText.slice(0, 8000);

  const parts = [{ text: `תוכן המסמך:\n\n${truncated}` }];

  const { text, tokenCount } = await callGemini(parts, systemPrompt);
  return { ...parseAnalysisJson(text, fallbackName), tokenCount };
}
