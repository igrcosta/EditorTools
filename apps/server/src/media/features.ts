import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { FeaturesResponse } from '@editools/shared';
import { config } from '../config';
import { canLoadOnnxRuntime, onnxLoadError } from './onnx';

export const MODEL_FILES = {
  isnet: 'isnet-general-use.onnx',
  yunet: 'face_detection_yunet_2023mar.onnx',
  // "small" (not "base"): meaningfully tighter word-level timestamps for karaoke captions —
  // base's -ml 1 -sow word splitting drifts noticeably, small's is visibly closer.
  whisperModel: 'ggml-small.bin',
  // Optional: pre-filters real speech before transcription (see whisper.ts). Captions still
  // work without it — transcribe() just skips the --vad flags when it's missing.
  vad: 'ggml-silero-v6.2.0.bin',
} as const;

export function modelPath(name: keyof typeof MODEL_FILES): string | null {
  if (!config.modelsDir) return null;
  const file = path.join(config.modelsDir, MODEL_FILES[name]);
  return existsSync(file) ? file : null;
}

/** Runtime availability: master switch(es) + files on disk + (for onnx tools) a loadable runtime. */
export async function getFeatures(log?: FastifyBaseLogger): Promise<FeaturesResponse> {
  const whisperMissing = config.whisperPath === null || !existsSync(config.whisperPath);
  if (config.captionsEnabled && (whisperMissing || modelPath('whisperModel') === null)) {
    log?.warn(
      { whisperPath: config.whisperPath, modelsDir: config.modelsDir },
      'captions unavailable: whisper binary or model not found on disk',
    );
  }
  const captions =
    config.captionsEnabled &&
    config.whisperPath !== null &&
    existsSync(config.whisperPath) &&
    modelPath('whisperModel') !== null;

  if (!config.imageToolsEnabled) {
    return { removeBackground: false, upscale: false, faceTracking: false, captions };
  }
  const ort = await canLoadOnnxRuntime();
  if (!ort) {
    log?.warn(
      { err: onnxLoadError() },
      'onnxruntime-node failed to load: Remove Background / Face Tracking unavailable',
    );
  }
  const upscaleAvailable = config.realesrganPath !== null && existsSync(config.realesrganPath);
  if (!upscaleAvailable) {
    log?.warn({ realesrganPath: config.realesrganPath }, 'upscale unavailable: realesrgan binary not found on disk');
  }
  return {
    removeBackground: ort && modelPath('isnet') !== null,
    faceTracking: ort && modelPath('yunet') !== null,
    upscale: upscaleAvailable,
    captions,
  };
}
