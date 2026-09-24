import type { InferenceSession } from 'onnxruntime-node';
import type { TrackAspect, TrackSmoothing } from '@editools/shared';
import { makeTensor } from './onnx';

/** YuNet (2023mar) has a fixed 640×640 input; frames are letterboxed into it. */
export const YUNET_SIZE = 640;
const STRIDES = [8, 16, 32] as const;
const SCORE_THRESHOLD = 0.7;
const NMS_THRESHOLD = 0.3;

export interface FaceBox {
  /** Centre and size in *analysis frame* pixels (before letterbox scaling is undone). */
  cx: number;
  cy: number;
  w: number;
  h: number;
  score: number;
}

/**
 * Face detection on one 640×640 BGR24 frame. Decoding follows OpenCV's
 * FaceDetectorYN: per stride, cx = (col + dx)·s, cy = (row + dy)·s,
 * w = exp(dw)·s, h = exp(dh)·s, score = sqrt(cls·obj), then NMS.
 */
export async function detectFaces(session: InferenceSession, bgr: Buffer): Promise<FaceBox[]> {
  const pixels = YUNET_SIZE * YUNET_SIZE;
  if (bgr.length !== pixels * 3) throw new Error(`EDITOOLS_INVALID_FILE: bad frame size ${bgr.length}`);
  const input = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    input[i] = bgr[i * 3];
    input[pixels + i] = bgr[i * 3 + 1];
    input[pixels * 2 + i] = bgr[i * 3 + 2];
  }
  const feeds = { [session.inputNames[0]]: await makeTensor(input, [1, 3, YUNET_SIZE, YUNET_SIZE]) };
  const wanted = STRIDES.flatMap((s) => [`cls_${s}`, `obj_${s}`, `bbox_${s}`]);
  const out = await session.run(feeds, wanted);

  const candidates: FaceBox[] = [];
  for (const s of STRIDES) {
    const cls = out[`cls_${s}`].data as Float32Array;
    const obj = out[`obj_${s}`].data as Float32Array;
    const bbox = out[`bbox_${s}`].data as Float32Array;
    const cols = YUNET_SIZE / s;
    for (let idx = 0; idx < cls.length; idx += 1) {
      const score = Math.sqrt(clamp01(cls[idx]) * clamp01(obj[idx]));
      if (score < SCORE_THRESHOLD) continue;
      const r = Math.floor(idx / cols);
      const c = idx % cols;
      candidates.push({
        cx: (c + bbox[idx * 4]) * s,
        cy: (r + bbox[idx * 4 + 1]) * s,
        w: Math.exp(bbox[idx * 4 + 2]) * s,
        h: Math.exp(bbox[idx * 4 + 3]) * s,
        score,
      });
    }
  }
  return nms(candidates);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function iou(a: FaceBox, b: FaceBox): number {
  const ax0 = a.cx - a.w / 2, ay0 = a.cy - a.h / 2, ax1 = a.cx + a.w / 2, ay1 = a.cy + a.h / 2;
  const bx0 = b.cx - b.w / 2, by0 = b.cy - b.h / 2, bx1 = b.cx + b.w / 2, by1 = b.cy + b.h / 2;
  const iw = Math.max(0, Math.min(ax1, bx1) - Math.max(ax0, bx0));
  const ih = Math.max(0, Math.min(ay1, by1) - Math.max(ay0, by0));
  const inter = iw * ih;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

function nms(boxes: FaceBox[]): FaceBox[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: FaceBox[] = [];
  for (const box of sorted) {
    if (kept.every((k) => iou(k, box) < NMS_THRESHOLD)) kept.push(box);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Trajectory → smooth crop track
// ---------------------------------------------------------------------------

export interface Sample {
  /** Seconds. */
  t: number;
  /** Face centre/size in source-video pixels, or null when no face was seen. */
  face: { cx: number; cy: number; size: number } | null;
}

export interface CropWindow {
  w: number;
  h: number;
}

export interface TrackPoint {
  t: number;
  x: number;
  y: number;
}

const SMOOTHING_SIGMA_S: Record<TrackSmoothing, number> = { low: 0.25, medium: 0.5, high: 0.9 };

/** Picks the face to follow: the largest one, preferring continuity with the previous pick. */
export function pickPrimary(faces: FaceBox[], previous: FaceBox | null): FaceBox | null {
  if (faces.length === 0) return null;
  const largest = faces.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  if (!previous) return largest;
  // Stick with the face nearest to the last one unless another is clearly bigger.
  const nearest = faces.reduce((a, b) =>
    Math.hypot(b.cx - previous.cx, b.cy - previous.cy) < Math.hypot(a.cx - previous.cx, a.cy - previous.cy) ? b : a,
  );
  return nearest.w * nearest.h * 1.6 >= largest.w * largest.h ? nearest : largest;
}

export function aspectRatio(aspect: TrackAspect): number {
  switch (aspect) {
    case '9:16':
      return 9 / 16;
    case '16:9':
      return 16 / 9;
    default: {
      const exhaustive: never = aspect;
      throw new Error(`EDITOOLS_INVALID_FILE: unknown aspect ${String(exhaustive)}`);
    }
  }
}

/** Largest crop of the requested aspect that fits the frame, shrunk by the zoom factor (even sizes). */
export function cropWindow(width: number, height: number, ratio: number, zoom: number): CropWindow {
  let w: number;
  let h: number;
  if (ratio <= width / height) {
    h = height;
    w = height * ratio;
  } else {
    w = width;
    h = width / ratio;
  }
  w /= zoom;
  h /= zoom;
  return { w: Math.max(16, even(Math.floor(w))), h: Math.max(16, even(Math.floor(h))) };
}

export function even(n: number): number {
  return n - (n % 2);
}

/**
 * Turns sparse detections into a per-output-frame crop position: gaps are
 * interpolated (edges held), the path is Gaussian-smoothed in time, the face
 * sits at 40% from the top of the crop, and the crop is clamped to the frame.
 */
export function buildTrack(
  samples: Sample[],
  frame: { width: number; height: number; fps: number; duration: number },
  crop: CropWindow,
  smoothing: TrackSmoothing,
): TrackPoint[] {
  const filled = fillGaps(samples);
  const sigma = SMOOTHING_SIGMA_S[smoothing];
  const xs = gaussianSmooth(filled.map((s) => s.cx), filled.map((s) => s.t), sigma);
  const ys = gaussianSmooth(filled.map((s) => s.cy), filled.map((s) => s.t), sigma);

  const frames = Math.max(1, Math.ceil(frame.duration * frame.fps) + 1);
  const track: TrackPoint[] = [];
  const maxX = frame.width - crop.w;
  const maxY = frame.height - crop.h;
  for (let n = 0; n < frames; n += 1) {
    const t = n / frame.fps;
    const cx = interpolate(filled, xs, t);
    const cy = interpolate(filled, ys, t);
    const x = even(Math.round(Math.min(maxX, Math.max(0, cx - crop.w / 2))));
    const y = even(Math.round(Math.min(maxY, Math.max(0, cy - crop.h * 0.4))));
    track.push({ t, x, y });
  }
  return track;
}

interface Filled {
  t: number;
  cx: number;
  cy: number;
}

function fillGaps(samples: Sample[]): Filled[] {
  const known = samples.filter((s) => s.face !== null);
  if (known.length === 0) throw new Error('EDITOOLS_NO_FACE_FOUND');
  return samples.map((s) => {
    if (s.face) return { t: s.t, cx: s.face.cx, cy: s.face.cy };
    // Linear interpolation between the nearest known neighbours; hold at the edges.
    let before: Sample | null = null;
    let after: Sample | null = null;
    for (const k of known) {
      if (k.t <= s.t) before = k;
      if (k.t >= s.t) {
        after = k;
        break;
      }
    }
    const b = before?.face ?? after!.face!;
    const a = after?.face ?? before!.face!;
    const span = (after?.t ?? s.t) - (before?.t ?? s.t);
    const f = span > 0 ? (s.t - (before?.t ?? s.t)) / span : 0;
    return { t: s.t, cx: b.cx + (a.cx - b.cx) * f, cy: b.cy + (a.cy - b.cy) * f };
  });
}

function gaussianSmooth(values: number[], times: number[], sigma: number): number[] {
  if (sigma <= 0 || values.length < 3) return values;
  const out: number[] = new Array(values.length);
  const radius = sigma * 3;
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let weight = 0;
    for (let j = 0; j < values.length; j += 1) {
      const dt = times[j] - times[i];
      if (Math.abs(dt) > radius) continue;
      const w = Math.exp(-(dt * dt) / (2 * sigma * sigma));
      sum += values[j] * w;
      weight += w;
    }
    out[i] = weight > 0 ? sum / weight : values[i];
  }
  return out;
}

function interpolate(points: Filled[], values: number[], t: number): number {
  if (t <= points[0].t) return values[0];
  const last = points.length - 1;
  if (t >= points[last].t) return values[last];
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const span = points[hi].t - points[lo].t;
  const f = span > 0 ? (t - points[lo].t) / span : 0;
  return values[lo] + (values[hi] - values[lo]) * f;
}

/** ffmpeg `sendcmd` script: one line per output frame updating the crop offset. */
export function sendcmdScript(track: TrackPoint[]): string {
  return track.map((p) => `${p.t.toFixed(4)} crop@c x ${p.x}, crop@c y ${p.y};`).join('\n') + '\n';
}
