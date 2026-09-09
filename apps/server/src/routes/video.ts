import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TRACK_ASPECTS, TRACK_SMOOTHING, TRACK_ZOOMS, type DownloadStarted } from '@editools/shared';
import { config } from '../config';
import { apiError } from '../media/errors';
import { getFeatures } from '../media/features';
import { createJob, createTempDir } from '../media/jobs';
import { faceTrackTask } from '../media/tasks';
import { receiveUpload, titleFrom, UploadTooLargeError } from './upload';

const faceTrackSchema = z
  .object({
    aspect: z.enum(TRACK_ASPECTS).default('original'),
    zoom: z.enum(TRACK_ZOOMS).default('1.2'),
    smoothing: z.enum(TRACK_SMOOTHING).default('medium'),
  })
  // Same aspect and no zoom would be a crop the size of the frame — nothing to follow.
  .refine((f) => !(f.aspect === 'original' && f.zoom === '1'), { message: 'nothing to track' });

export function registerVideoRoutes(app: FastifyInstance): void {
  app.post('/api/video/face-track', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!(await getFeatures()).faceTracking) return reply.code(503).send(apiError('feature_unavailable'));
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? faceTrackSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const { aspect, zoom, smoothing } = parsed.data;
      const job = await createJob(
        faceTrackTask({
          inputPath: upload.inputPath,
          aspect,
          zoom: Number(zoom),
          smoothing,
          title: `${titleFrom(upload.originalName)} (face tracked)`,
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
