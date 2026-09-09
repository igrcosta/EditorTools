import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { FastifyRequest } from 'fastify';

export interface UploadedFile {
  inputPath: string;
  originalName: string;
  fields: Record<string, string>;
}

export class UploadTooLargeError extends Error {}

/**
 * Streams the single uploaded file into `tempDir/input.<ext>` and collects the
 * plain fields sent alongside it (clients must append fields before the file).
 */
export async function receiveUpload(request: FastifyRequest, tempDir: string): Promise<UploadedFile | null> {
  const data = await request.file();
  if (!data) return null;

  const rawExt = path.extname(data.filename ?? '').toLowerCase();
  const ext = /^\.[a-z0-9]{1,5}$/.test(rawExt) ? rawExt : '';
  const inputPath = path.join(tempDir, `input${ext}`);
  await pipeline(data.file, createWriteStream(inputPath));
  if (data.file.truncated) throw new UploadTooLargeError();

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(data.fields)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first && typeof first === 'object' && 'value' in first && typeof first.value === 'string') {
      fields[key] = first.value;
    }
  }
  return { inputPath, originalName: data.filename ?? 'file', fields };
}

/** Display title derived from the uploaded filename (without extension). */
export function titleFrom(originalName: string): string {
  return path.basename(originalName, path.extname(originalName));
}
