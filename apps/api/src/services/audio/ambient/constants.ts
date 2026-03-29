import type { AmbientSoundType } from '@voice/shared';

export const IDLE_GAP_MS = 80;

// 20ms frame at 24kHz, 16-bit mono: 24000 * 0.02 * 2
export const IDLE_FRAME_BYTES = 960;

export const MAX_AMBIENT_VOLUME = 0.2;

const FILE_MAP: Record<Exclude<AmbientSoundType, 'NONE'>, string> = {
  OFFICE: 'office.raw',
  CAFE: 'cafe.raw',
  RESTAURANT: 'restaurant.raw',
  CITY: 'city.raw',
  PEOPLE_TALKING: 'people_talking.raw',
};

export function ambientFileName(type: AmbientSoundType): string | null {
  if (type === 'NONE') return null;
  return FILE_MAP[type] ?? null;
}
