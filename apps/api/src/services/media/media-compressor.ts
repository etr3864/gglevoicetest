import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import type { CompressionResult } from './types';

const execFileAsync = promisify(execFile);

const IMAGE_LIMIT = 5 * 1024 * 1024;
const VIDEO_LIMIT = 16 * 1024 * 1024;

const IMAGE_ATTEMPTS = [
  { quality: 82, maxDim: 2048 },
  { quality: 72, maxDim: 2048 },
  { quality: 72, maxDim: 1600 },
  { quality: 65, maxDim: 1200 },
];

async function compressImage(buffer: Buffer, mimeType: string): Promise<CompressionResult> {
  const sharp = (await import('sharp')).default;
  const originalSize = buffer.length;

  if (originalSize <= IMAGE_LIMIT) {
    return { buffer, wasCompressed: false, originalSize, finalSize: originalSize };
  }

  const metadata = await sharp(buffer).metadata();
  const hasAlpha = metadata.hasAlpha ?? false;

  for (const { quality, maxDim } of IMAGE_ATTEMPTS) {
    let pipeline = sharp(buffer).resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true });

    if (hasAlpha || mimeType === 'image/png') {
      pipeline = pipeline.png({ compressionLevel: 9 }) as typeof pipeline;
    } else {
      pipeline = pipeline.jpeg({ quality, progressive: true }) as typeof pipeline;
    }

    const result = await pipeline.toBuffer();
    if (result.length <= IMAGE_LIMIT) {
      return { buffer: result, wasCompressed: true, originalSize, finalSize: result.length };
    }
  }

  throw new Error('Image cannot be compressed below 5MB for WhatsApp');
}

async function getVideoDuration(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    inputPath,
  ]);
  const data = JSON.parse(stdout) as { format: { duration: string } };
  return parseFloat(data.format.duration);
}

function resolveVideoScale(videoBitrateKbps: number): string {
  if (videoBitrateKbps >= 1500) return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  if (videoBitrateKbps >= 800) return 'scale=1280:720:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2';
  return 'scale=854:480:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2';
}

async function extractThumbnail(inputPath: string, thumbPath: string): Promise<Buffer | undefined> {
  try {
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-ss', '00:00:01',
      '-frames:v', '1',
      '-vf', 'scale=320:-1',
      '-threads', '2',
      '-y',
      thumbPath,
    ]);
    return await fs.readFile(thumbPath);
  } catch {
    return undefined;
  }
}

async function compressVideo(buffer: Buffer): Promise<CompressionResult> {
  const originalSize = buffer.length;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'media-'));
  const inputPath = path.join(tmpDir, 'input.mp4');
  const outputPath = path.join(tmpDir, 'out.mp4');
  const thumbPath = path.join(tmpDir, 'thumb.jpg');

  try {
    await fs.writeFile(inputPath, buffer);

    const duration = await getVideoDuration(inputPath);
    const audioBitrateKbps = 128;
    const targetBytes = VIDEO_LIMIT * 0.94;
    const videoBitrateKbps = Math.max(
      100,
      Math.floor((targetBytes * 8 - audioBitrateKbps * 1000 * duration) / duration / 1000),
    );

    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-vf', resolveVideoScale(videoBitrateKbps),
      '-c:v', 'libx264',
      '-b:v', `${videoBitrateKbps}k`,
      '-c:a', 'aac',
      '-b:a', `${audioBitrateKbps}k`,
      '-movflags', '+faststart',
      '-threads', '2',
      '-y',
      outputPath,
    ]);

    const result = await fs.readFile(outputPath);
    if (result.length > VIDEO_LIMIT) {
      throw new Error('Video cannot be compressed below 16MB for WhatsApp');
    }

    const thumbnailBuffer = await extractThumbnail(inputPath, thumbPath);

    return {
      buffer: result,
      wasCompressed: true,
      originalSize,
      finalSize: result.length,
      thumbnailBuffer,
    };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function generateThumbnailOnly(buffer: Buffer): Promise<Buffer | undefined> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
  const inputPath = path.join(tmpDir, 'input.mp4');
  const thumbPath = path.join(tmpDir, 'thumb.jpg');

  try {
    await fs.writeFile(inputPath, buffer);
    return await extractThumbnail(inputPath, thumbPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

export async function compressIfNeeded(
  buffer: Buffer,
  mediaType: 'image' | 'video' | 'file',
  mimeType: string,
): Promise<CompressionResult> {
  const originalSize = buffer.length;

  if (mediaType === 'image') return compressImage(buffer, mimeType);

  if (mediaType === 'video') {
    if (originalSize <= VIDEO_LIMIT) {
      const thumbnailBuffer = await generateThumbnailOnly(buffer);
      return { buffer, wasCompressed: false, originalSize, finalSize: originalSize, thumbnailBuffer };
    }
    return compressVideo(buffer);
  }

  return { buffer, wasCompressed: false, originalSize, finalSize: originalSize };
}
