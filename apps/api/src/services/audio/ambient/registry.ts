import type { AmbientSoundType } from '@voice/shared';
import { createLogger } from '../../../lib/logger';
import { ambientFileName } from './constants';
import { loadAmbientBuffer } from './load-buffers';

const log = createLogger('ambient-registry');

const cache = new Map<string, Promise<Buffer | null>>();

export function getAmbientBuffer(type: AmbientSoundType): Promise<Buffer | null> {
  if (type === 'NONE') return Promise.resolve(null);

  const filename = ambientFileName(type);
  if (!filename) return Promise.resolve(null);

  if (!cache.has(filename)) {
    cache.set(
      filename,
      loadAmbientBuffer(filename).catch((err) => {
        log.warn('Ambient buffer load failed — degrading to NONE', { filename, err });
        return null;
      }),
    );
  }

  return cache.get(filename)!;
}
