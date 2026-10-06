import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  LOUDNESS_PRESETS,
  NOISE_LEVELS,
  SILENCE_MODES,
  type DownloadStarted,
  type TimelineSegment,
} from '@editools/shared';
import { config } from '../config';
import { planContext, rejectOverPlanDuration } from '../account/enforcement';
import { apiError } from '../media/errors';
import { createJob, createTempDir } from '../media/jobs';
import { analyzeTimelineTask, audioFixTask, cutSegmentsTask } from '../media/tasks';
import { receiveUpload, titleFrom, UploadTooLargeError } from './upload';

const fixFieldsSchema = z
  .object({
    noise: z.enum(NOISE_LEVELS),
    loudness: z.enum(LOUDNESS_PRESETS),
    output: z.enum(['wav', 'mp3']),
  })
  .refine((f) => f.noise !== 'off' || f.loudness !== 'off', { message: 'nothing to do' });

/** Parses a JSON field and validates it against `schema`; malformed JSON fails validation
 *  instead of throwing (zod's `.transform` runs outside the usual try/catch of `.safeParse`). */
function jsonField<T extends z.ZodTypeAny>(schema: T) {
  return z.string().transform((v, ctx) => {
    let raw: unknown;
    try {
      raw = JSON.parse(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'invalid JSON' });
      return z.NEVER;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: 'invalid value' });
      return z.NEVER;
    }
    return parsed.data as z.infer<T>;
  });
}

const timelineRangeSchema = z
  .object({ start: z.number().min(0), end: z.number().positive() })
  .refine((r) => r.end > r.start, { message: 'invalid range' });

const analyzeFieldsSchema = z.object({
  mode: z.enum(SILENCE_MODES),
  range: jsonField(timelineRangeSchema).optional(),
  sample: jsonField(timelineRangeSchema).optional(),
});

const cutFieldsSchema = z.object({
  segments: jsonField(z.array(timelineRangeSchema).min(1)),
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

      const over = await rejectOverPlanDuration(request, reply, tempDir, upload.inputPath);
      if (over) return over;

      const job = await createJob(
        audioFixTask({
          inputPath: upload.inputPath,
          noise: parsed.data.noise,
          loudness: parsed.data.loudness,
          output: parsed.data.output,
          title: `${titleFrom(upload.originalName)} (clean)`,
        }),
        tempDir,
        planContext(request),
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

  app.post('/api/audio/timeline/analyze', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? analyzeFieldsSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const over = await rejectOverPlanDuration(request, reply, tempDir, upload.inputPath);
      if (over) return over;

      const { mode, range, sample } = parsed.data;
      const job = await createJob(
        analyzeTimelineTask({
          inputPath: upload.inputPath,
          mode,
          range,
          sample,
          title: titleFrom(upload.originalName),
        }),
        tempDir,
        planContext(request),
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

  app.post('/api/audio/timeline/cut', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? cutFieldsSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const over = await rejectOverPlanDuration(request, reply, tempDir, upload.inputPath);
      if (over) return over;

      const segments: TimelineSegment[] = parsed.data.segments;
      const job = await createJob(
        cutSegmentsTask({
          inputPath: upload.inputPath,
          segments,
          title: `${titleFrom(upload.originalName)} (cut)`,
        }),
        tempDir,
        planContext(request),
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
