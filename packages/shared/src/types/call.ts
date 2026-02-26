export type CallDirection = 'inbound' | 'outbound';
export type CallStatus = 'queued' | 'calling' | 'in_call' | 'completed' | 'no_answer' | 'failed';

export interface Call {
  id: string;
  agentId: string;
  contactId: string | null;
  direction: CallDirection;
  status: CallStatus;
  context: Record<string, unknown> | null;
  recordingUrl: string | null;
  durationSec: number | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface Utterance {
  id: string;
  callId: string;
  speaker: 'agent' | 'customer';
  startMs: number;
  endMs: number;
  text: string;
}

export interface CreateOutboundCallBody {
  agent_id: string;
  phone: string;
  contact_name?: string;
  gender?: 'male' | 'female' | 'unknown';
  context?: Record<string, unknown>;
}
