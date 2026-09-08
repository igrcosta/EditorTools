import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AnalyzeResult } from '@editools/shared';
import { config } from '../config';
import { apiError, mapYtdlpError, stderrOf } from '../media/errors';
import { analyzeMedia } from '../media/ytdlp';
import { assertSafeUrl, UrlGuardError } from '../security/urlGuard';

const bodySchema = z.object({
  url: z.string().min(1).max(2048),
});

export function registerAnalyzeRoute(app: FastifyInstance): void {
  app.post('/api/analyze', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('invalid_url'));

    let url: URL;
    try {
      url = await assertSafeUrl(parsed.data.url);
    } catch (err) {
      const code = err instanceof UrlGuardError ? err.code : 'invalid_url';
      return reply.code(400).send(apiError(code));
    }

    let result: AnalyzeResult;
    try {
      result = await analyzeMedia(url.toString());
    } catch (err) {
      request.log.debug({ stderr: stderrOf(err) }, 'analyze failed');
      return reply.code(422).send(apiError(mapYtdlpError(stderrOf(err))));
    }

    if (result.durationSeconds !== null && result.durationSeconds > config.maxDurationSeconds) {
      return reply.code(422).send(apiError('too_long'));
    }
    return result;
  });
}
