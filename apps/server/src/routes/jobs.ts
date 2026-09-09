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
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function registerJobRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = UUID_RE.test(request.params.id) ? getJob(request.params.id) : undefined;
    if (!job) return reply.code(404).send(apiError('not_found'));
    return toJobState(job);
  });

  app.get<{ Params: { id: string }; Querystring: { inline?: string } }>(
    '/api/jobs/:id/file',
    async (request, reply) => {
      const job = UUID_RE.test(request.params.id) ? getJob(request.params.id) : undefined;
      if (!job || job.status !== 'done' || !job.filePath || !job.filename || !job.fileSizeBytes) {
        return reply.code(404).send(apiError('not_found'));
      }
      const asciiFallback = job.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
      const ext = job.filename.slice(job.filename.lastIndexOf('.')).toLowerCase();
      const size = job.fileSizeBytes;
      const inline = request.query.inline === '1';

      void reply
        .header('content-type', CONTENT_TYPES[ext] ?? 'application/octet-stream')
        .header('accept-ranges', 'bytes')
        .header(
          'content-disposition',
          inline
            ? 'inline'
            : `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(job.filename)}`,
        );

      // Range support so the in-app preview players can seek.
      const rangeHeader = request.headers.range;
      const m = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
      if (m && (m[1] || m[2])) {
        const start = m[1] ? Math.min(Number(m[1]), size - 1) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start > end) {
          return reply.code(416).header('content-range', `bytes */${size}`).send();
        }
        return reply
          .code(206)
          .header('content-range', `bytes ${start}-${end}/${size}`)
          .header('content-length', end - start + 1)
          .send(createReadStream(job.filePath, { start, end }));
      }

      return reply.header('content-length', size).send(createReadStream(job.filePath));
    },
  );

  app.delete<{ Params: { id: string } }>('/api/jobs/:id', async (request, reply) => {
    const job = UUID_RE.test(request.params.id) ? getJob(request.params.id) : undefined;
    if (!job) return reply.code(404).send(apiError('not_found'));
    await cancelJob(job);
    return reply.code(204).send();
  });
}
