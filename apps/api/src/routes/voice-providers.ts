import { Router } from 'express';
import { getRuntime, getCapabilities } from '../services/voice-runtime';
import type { VoiceProviderId } from '../services/voice-runtime/types';
import { LLM_MODELS } from '../services/llm/models';

const router = Router();

const VALID_PROVIDERS: VoiceProviderId[] = ['gemini_live', 'elevenlabs'];

router.get('/voice-providers', (_req, res) => {
  const providers = VALID_PROVIDERS.map((id) => ({
    id,
    capabilities: getCapabilities(id),
    voices: getRuntime(id).listVoices(),
  }));

  res.json({ data: providers });
});

router.get('/voice-providers/:id/voices', (req, res) => {
  const id = req.params.id as VoiceProviderId;
  if (!VALID_PROVIDERS.includes(id)) {
    res.status(400).json({ error: 'Unknown provider' });
    return;
  }

  res.json({ data: getRuntime(id).listVoices() });
});

router.get('/llm-models', (_req, res) => {
  const models = LLM_MODELS.map((m) => ({
    id: m.id,
    name: m.displayName,
    provider: m.provider,
    available: m.available,
  }));

  res.json({ data: models });
});

export default router;
