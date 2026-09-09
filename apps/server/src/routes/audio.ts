import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LOUDNESS_PRESETS, NOISE_LEVELS, type DownloadStarted } from '@editools/shared';
import { config } from '../config';
import { apiError } from '../media/errors';
import { createJob, createTempDir } from '../media/jobs';
import { audioFixTask, trimTask } from '../media/tasks';
import { receiveUpload, titleFrom, UploadTooLargeError } from './upload';

const fixFieldsSchema = z
  .object({
    noise: z.enum(NOISE_LEVELS),
    loudness: z.enum(LOUDNESS_PRESETS),
    output: z.enum(['wav', 'mp3']),
  })
  .refine((f) => f.noise !== 'off' || f.loudness !== 'off', { message: 'nothing to do' });

const trimFieldsSchema = z
  .object({
    start: z.coerce.number().min(0),
    end: z.coerce.number().positive(),
  })
  .refine((f) => f.end > f.start && f.end - f.start <= config.maxDurationSeconds, {
    message: 'invalid range',
  });

export function registerAudioRoutes(app: FastifyInstance): void {
  app.post('/api/audio/fix', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? fixFieldsSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const job = await createJob(
        audioFixTask({
          inputPath: upload.inputPath,
          noise: parsed.data.noise,
          loudness: parsed.data.loudness,
          output: parsed.data.output,
          title: `${titleFrom(upload.originalName)} (clean)`,
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

  app.post('/api/audio/trim', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? trimFieldsSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const job = await createJob(
        trimTask({
          inputPath: upload.inputPath,
          startSeconds: parsed.data.start,
          endSeconds: parsed.data.end,
          title: `${titleFrom(upload.originalName)} (trimmed)`,
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
