import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CONVERT_FORMATS, type DownloadStarted } from '@editools/shared';
import { config } from '../config';
import { apiError } from '../media/errors';
import { createJob, createTempDir } from '../media/jobs';
import { convertTask } from '../media/tasks';
import { receiveUpload, titleFrom, UploadTooLargeError } from './upload';

const fieldsSchema = z.object({
  format: z.enum(CONVERT_FORMATS),
});

export function registerConvertRoute(app: FastifyInstance): void {
  app.post('/api/convert', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      if (!upload) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }
      const parsed = fieldsSchema.safeParse(upload.fields);
      if (!parsed.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const job = await createJob(
        convertTask({
          inputPath: upload.inputPath,
          format: parsed.data.format,
          title: titleFrom(upload.originalName),
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
