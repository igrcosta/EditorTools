import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COOKIE_BROWSERS, effectiveCap, type DownloadStarted } from '@editools/shared';
import { checkPlan, limitsOf, planContext, sendLimit } from '../account/enforcement';
import { config } from '../config';
import { apiError } from '../media/errors';
import { createJob } from '../media/jobs';
import { downloadTask } from '../media/tasks';
import { assertSafeUrl, UrlGuardError } from '../security/urlGuard';

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
  output: z.enum(['mp4', 'mp3']),
  height: z.number().int().min(144).max(4320).optional(),
  title: z.string().max(300).optional(),
  cookiesFromBrowser: z.enum(COOKIE_BROWSERS).optional(),
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

    // Plan limits. A video asked for above the plan's height is refused (the UI offers an upgrade);
    // "no height chosen" means best quality, which the plan caps instead of refusing.
    const limits = limitsOf(request);
    let height = parsed.data.height;
    if (parsed.data.output === 'mp4') {
      const check = checkPlan(request, { downloadHeight: height });
      if (!check.ok) return sendLimit(reply, check);
      if (limits?.maxDownloadHeight != null) height ??= limits.maxDownloadHeight;
    }

    const job = await createJob(
      downloadTask({
        url: url.toString(),
        output: parsed.data.output,
        height,
        title: parsed.data.title,
        cookiesFromBrowser: parsed.data.cookiesFromBrowser,
        maxDurationSeconds: effectiveCap(config.maxDurationSeconds, limits?.maxMediaSeconds ?? null),
      }),
      undefined,
      planContext(request),
    );
    if (job === 'busy') return reply.code(429).send(apiError('busy'));

    const started: DownloadStarted = { jobId: job.id };
    return reply.code(202).send(started);
  });
}
