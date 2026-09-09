import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FeaturesResponse } from '@editools/shared';
import { config } from '../config';
import { canLoadOnnxRuntime } from './onnx';

export const MODEL_FILES = {
  isnet: 'isnet-general-use.onnx',
  yunet: 'face_detection_yunet_2023mar.onnx',
} as const;

export function modelPath(name: keyof typeof MODEL_FILES): string | null {
  if (!config.modelsDir) return null;
  const file = path.join(config.modelsDir, MODEL_FILES[name]);
  return existsSync(file) ? file : null;
}

/** Runtime availability: master switch + files on disk + loadable ONNX runtime. */
export async function getFeatures(): Promise<FeaturesResponse> {
  if (!config.imageToolsEnabled) {
    return { removeBackground: false, upscale: false, faceTracking: false };
  }
  const ort = await canLoadOnnxRuntime();
  return {
    removeBackground: ort && modelPath('isnet') !== null,
    faceTracking: ort && modelPath('yunet') !== null,
    upscale: config.realesrganPath !== null && existsSync(config.realesrganPath),
  };
}
