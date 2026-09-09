import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { apiError } from '../media/errors';
import { cancelJob, getJob, toJobState } from '../media/jobs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.aac': 'audio/aac',
};

export function registerJobRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = UUID_RE.test(request.params.id) ? getJob(request.params.id) : undefined;
    if (!job) return reply.code(404).send(apiError('not_found'));
    return toJobState(job);
  });

  app.get<{ Params: { id: string } }>('/api/jobs/:id/file', async (request, reply) => {
    const job = UUID_RE.test(request.params.id) ? getJob(request.params.id) : undefined;
    if (!job || job.status !== 'done' || !job.filePath || !job.filename) {
      return reply.code(404).send(apiError('not_found'));
    }
    const asciiFallback = job.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
    const ext = job.filename.slice(job.filename.lastIndexOf('.')).toLowerCase();
    return reply
      .header('content-type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
      .header('content-length', job.fileSizeBytes ?? undefined)
      .header(
        'content-disposition',
        `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
      )
      .send(createReadStream(job.filePath));
  });

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = UUID_RE.test(request.params.id) ? getJob(request.params.id) : undefined;
    if (!job) return reply.code(404).send(apiError('not_found'));
    await cancelJob(job);
    return reply.code(204).send();
  });
}
