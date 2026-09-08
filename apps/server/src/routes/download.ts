import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DownloadStarted } from '@editools/shared';
import { apiError } from '../media/errors';
import { createJob } from '../media/jobs';
import { assertSafeUrl, UrlGuardError } from '../security/urlGuard';

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
  output: z.enum(['mp4', 'mp3']),
  height: z.number().int().min(144).max(4320).optional(),
  title: z.string().max(300).optional(),
});

export function registerDownloadRoute(app: FastifyInstance): void {
  app.post('/api/download', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('invalid_url'));

    let url: URL;
    try {
      url = await assertSafeUrl(parsed.data.url);
    } catch (err) {
      const code = err instanceof UrlGuardError ? err.code : 'invalid_url';
      return reply.code(400).send(apiError(code));
    }

    const job = await createJob({
      url: url.toString(),
      output: parsed.data.output,
      height: parsed.data.height,
      title: parsed.data.title,
    });
    if (job === 'busy') return reply.code(429).send(apiError('busy'));

    const started: DownloadStarted = { jobId: job.id };
    return reply.code(202).send(started);
  });
}
