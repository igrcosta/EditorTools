import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BG_OUTPUTS, UPSCALE_MODELS, UPSCALE_OUTPUTS, type DownloadStarted } from '@editools/shared';
import { config } from '../config';
import { apiError } from '../media/errors';
import { getFeatures } from '../media/features';
import { createJob, createTempDir } from '../media/jobs';
import { removeBackgroundTask, upscaleTask } from '../media/tasks';
import { receiveUpload, titleFrom, UploadTooLargeError } from './upload';

const removeBgSchema = z.object({
  output: z.enum(BG_OUTPUTS).default('png'),
});

const upscaleSchema = z.object({
  model: z.enum(UPSCALE_MODELS).default('photo'),
  scale: z.coerce.number().pipe(z.union([z.literal(2), z.literal(4)])).default(4),
  output: z.enum(UPSCALE_OUTPUTS).default('png'),
});

export function registerImageRoutes(app: FastifyInstance): void {
  app.post('/api/image/remove-background', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!(await getFeatures()).removeBackground) return reply.code(503).send(apiError('feature_unavailable'));
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? removeBgSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const job = await createJob(
        removeBackgroundTask({
          inputPath: upload.inputPath,
          output: parsed.data.output,
          title: `${titleFrom(upload.originalName)} (no background)`,
        }),
        tempDir,
      );
      if (job === 'busy') {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(429).send(apiError('busy'));
      }
      const started: DownloadStarted = { jobId: job.id };
      return reply.code(202).send(started);
    } catch (err) {
      await rm(tempDir, { recursive: true, force: true });
      if (err instanceof UploadTooLargeError) return reply.code(413).send(apiError('too_large'));
      throw err;
    }
  });

  app.post('/api/image/upscale', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!(await getFeatures()).upscale) return reply.code(503).send(apiError('feature_unavailable'));
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? upscaleSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const { model, scale, output } = parsed.data;
      const job = await createJob(
        upscaleTask({
          inputPath: upload.inputPath,
          model,
          scale,
          output,
          title: `${titleFrom(upload.originalName)} (${scale}x)`,
        }),
        tempDir,
      );
      if (job === 'busy') {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(429).send(apiError('busy'));
      }
      const started: DownloadStarted = { jobId: job.id };
      return reply.code(202).send(started);
    } catch (err) {
      await rm(tempDir, { recursive: true, force: true });
      if (err instanceof UploadTooLargeError) return reply.code(413).send(apiError('too_large'));
      throw err;
    }
  });
}
