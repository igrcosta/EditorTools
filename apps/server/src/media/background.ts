import type { InferenceSession } from 'onnxruntime-node';
import { makeTensor } from './onnx';

/** ISNet (DIS) works on a fixed 1024×1024 square; the mask is scaled back afterwards. */
export const ISNET_SIZE = 1024;

/**
 * Runs ISNet on a 1024×1024 RGB24 buffer and returns an 8-bit alpha mask of
 * the same size. Pre/post-processing mirrors rembg's `ISNetSession`:
 * pixels / 255, mean 0.5, std 1.0; output min-max normalised to 0..255.
 */
export async function predictAlphaMask(session: InferenceSession, rgb: Buffer): Promise<Buffer> {
  const pixels = ISNET_SIZE * ISNET_SIZE;
  if (rgb.length !== pixels * 3) {
    throw new Error(`EDITOOLS_INVALID_FILE: expected ${pixels * 3} bytes, got ${rgb.length}`);
  }
  const input = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    input[i] = rgb[i * 3] / 255 - 0.5;
    input[pixels + i] = rgb[i * 3 + 1] / 255 - 0.5;
    input[pixels * 2 + i] = rgb[i * 3 + 2] / 255 - 0.5;
  }
  const feeds = { [session.inputNames[0]]: await makeTensor(input, [1, 3, ISNET_SIZE, ISNET_SIZE]) };
  const outputName = session.outputNames.includes('output_image') ? 'output_image' : session.outputNames[0];
  const result = await session.run(feeds, [outputName]);
  const pred = result[outputName].data as Float32Array;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pred.length; i += 1) {
    if (pred[i] < min) min = pred[i];
    if (pred[i] > max) max = pred[i];
  }
  const range = max - min || 1;
  const mask = Buffer.alloc(pixels);
  for (let i = 0; i < pixels; i += 1) {
    mask[i] = Math.round(((pred[i] - min) / range) * 255);
  }
  return mask;
}
