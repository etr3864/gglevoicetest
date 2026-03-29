import path from 'path';
import fs from 'fs/promises';

export function resolveAmbientAssetsRoot(): string {
  return path.join(process.cwd(), 'assets', 'ambient', 'raw');
}

export async function loadAmbientBuffer(filename: string): Promise<Buffer> {
  return fs.readFile(path.join(resolveAmbientAssetsRoot(), filename));
}
