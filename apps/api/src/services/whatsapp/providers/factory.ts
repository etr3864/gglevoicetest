import { MetaWhatsappProvider } from './meta';
import { WasenderWhatsappProvider } from './wasender';
import type { WhatsappProvider, MetaConfig, WasenderConfig } from './types';
import { decryptConfig } from '../config-crypto';

function assertMetaConfig(raw: unknown): MetaConfig {
  const c = raw as Record<string, unknown>;
  if (!c.phoneNumberId || !c.accessToken || !c.verifyToken || !c.appSecret) {
    throw new Error('Invalid Meta WhatsApp config — missing required fields');
  }
  return c as unknown as MetaConfig;
}

function assertWasenderConfig(raw: unknown): WasenderConfig {
  const c = raw as Record<string, unknown>;
  if (!c.apiKey || !c.session || !c.webhookSecret) {
    throw new Error('Invalid WA Sender config — missing required fields');
  }
  return c as unknown as WasenderConfig;
}

export function createProvider(agent: {
  whatsappProvider: string;
  whatsappConfig: string | null;
}): WhatsappProvider {
  if (!agent.whatsappConfig) {
    throw new Error('Agent has no WhatsApp config');
  }

  const decrypted = decryptConfig(agent.whatsappConfig);

  if (agent.whatsappProvider === 'meta') {
    return new MetaWhatsappProvider(assertMetaConfig(decrypted));
  }

  if (agent.whatsappProvider === 'wasender') {
    return new WasenderWhatsappProvider(assertWasenderConfig(decrypted));
  }

  throw new Error(`Unknown WhatsApp provider: ${agent.whatsappProvider}`);
}
