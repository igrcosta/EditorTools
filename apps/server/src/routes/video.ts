import { rm } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CAPTION_FONTS,
  CAPTION_POSITION_DEFAULT,
  CAPTION_POSITION_Y_DEFAULT,
  CAPTION_PRESETS,
  CAPTION_SCALE_DEFAULT,
  CAPTION_SCALE_MAX,
  CAPTION_SCALE_MIN,
  TRACK_ASPECTS,
  TRACK_SMOOTHING,
  TRACK_ZOOM_DEFAULT,
  TRACK_ZOOM_MAX,
  TRACK_ZOOM_MIN,
  type DownloadStarted,
} from '@editools/shared';
import { config } from '../config';
import { apiError } from '../media/errors';
import { getFeatures } from '../media/features';
import { createJob, createTempDir } from '../media/jobs';
import { faceTrackTask, renderCaptionsTask, transcribeCaptionsTask } from '../media/tasks';
import { receiveUpload, titleFrom, UploadTooLargeError } from './upload';

const captionWordSchema = z.object({
  text: z.string().min(1).max(80),
  start: z.number().min(0),
  end: z.number().min(0),
});

/** Multipart fields are always strings — the edited word list travels as a JSON string field. */
const captionWordsField = z.string().transform((raw, ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid words JSON' });
    return z.NEVER;
  }
  const result = z.array(captionWordSchema).min(1).max(4000).safeParse(parsed);
  if (!result.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid words shape' });
    return z.NEVER;
  }
  return result.data;
});

const hexColor = z.string().regex(/^[0-9A-Fa-f]{6}$/, 'expected a 6-digit hex color');

const customCaptionStyleSchema = z.object({
  font: z.enum(CAPTION_FONTS),
  primaryColorRgb: hexColor,
  outline: z.boolean(),
  outlineColorRgb: hexColor,
  shadow: z.boolean(),
});

/** Multipart fields are always strings — an unset custom template travels as an absent field. */
const customStyleField = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid customStyle JSON' });
      return z.NEVER;
    }
    const result = customCaptionStyleSchema.safeParse(parsed);
    if (!result.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid customStyle shape' });
      return z.NEVER;
    }
    return result.data;
  });

const captionsRenderSchema = z.object({
  words: captionWordsField,
  preset: z.enum(CAPTION_PRESETS).default('clean'),
  customStyle: customStyleField,
  positionX: z.coerce.number().min(0).max(1).default(CAPTION_POSITION_DEFAULT),
  positionY: z.coerce.number().min(0).max(1).default(CAPTION_POSITION_Y_DEFAULT),
  scale: z.coerce.number().min(CAPTION_SCALE_MIN).max(CAPTION_SCALE_MAX).default(CAPTION_SCALE_DEFAULT),
});

const faceTrackSchema = z.object({
  aspect: z.enum(TRACK_ASPECTS).default('9:16'),
  zoom: z.coerce.number().min(TRACK_ZOOM_MIN).max(TRACK_ZOOM_MAX).default(TRACK_ZOOM_DEFAULT),
  smoothing: z.enum(TRACK_SMOOTHING).default('medium'),
});

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
          zoom,
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

  app.post('/api/video/captions/transcribe', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!(await getFeatures()).captions) return reply.code(503).send(apiError('feature_unavailable'));
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      if (!upload) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const job = await createJob(
        transcribeCaptionsTask({ inputPath: upload.inputPath, title: titleFrom(upload.originalName) }),
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

  app.post('/api/video/captions/render', { bodyLimit: config.maxUploadBytes }, async (request, reply) => {
    if (!(await getFeatures()).captions) return reply.code(503).send(apiError('feature_unavailable'));
    if (!request.isMultipart()) return reply.code(400).send(apiError('invalid_file'));

    const tempDir = await createTempDir();
    try {
      const upload = await receiveUpload(request, tempDir);
      const parsed = upload ? captionsRenderSchema.safeParse(upload.fields) : null;
      if (!upload || !parsed?.success) {
        await rm(tempDir, { recursive: true, force: true });
        return reply.code(400).send(apiError('invalid_file'));
      }

      const { words, preset, customStyle, positionX, positionY, scale } = parsed.data;
      const job = await createJob(
        renderCaptionsTask({
          inputPath: upload.inputPath,
          words,
          preset,
          customStyle,
          positionX,
          positionY,
          scale,
          title: `${titleFrom(upload.originalName)} (captioned)`,
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
