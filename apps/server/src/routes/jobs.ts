import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { apiError } from '../media/errors';
import { cancelJob, getJob, toJobState } from '../media/jobs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
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
    return reply
      .header('content-type', CONTENT_TYPES[job.output] ?? 'application/octet-stream')
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
