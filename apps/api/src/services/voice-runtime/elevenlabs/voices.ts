import type { VoiceOption } from '../types';

export const ELEVENLABS_VOICES: VoiceOption[] = [
  { id: 'cjVigY5qzO86Huf0OWal', name: 'Eric (עברית)', gender: 'male' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris (עברית)', gender: 'male' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel (עברית)', gender: 'male' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte (עברית)', gender: 'female' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', name: 'Alice (עברית)', gender: 'female' },
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Lily (עברית)', gender: 'female' },
];

export const DEFAULT_VOICE_ID = ELEVENLABS_VOICES[0].id;
