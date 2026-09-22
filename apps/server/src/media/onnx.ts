import type { InferenceSession, Tensor } from 'onnxruntime-node';

type Ort = typeof import('onnxruntime-node');

/**
 * Lazy, cached access to onnxruntime-node. The module is native (ships its
 * own .node binding) so it is loaded on demand: the web deploy never touches
 * it, the desktop app externalizes it from the esbuild bundle.
 */
let ortPromise: Promise<Ort | null> | null = null;
let lastLoadError: unknown = null;

export function loadOrt(): Promise<Ort | null> {
  if (!ortPromise) {
    ortPromise = import('onnxruntime-node').then(
      (m) => m,
      (err) => {
        lastLoadError = err;
        return null;
      },
    );
  }
  return ortPromise;
}

export async function canLoadOnnxRuntime(): Promise<boolean> {
  return (await loadOrt()) !== null;
}

/** The error from the last failed load attempt, for diagnostics (e.g. missing VC++ runtime, wrong arch). */
export function onnxLoadError(): unknown {
  return lastLoadError;
}

interface CachedSession {
  session: Promise<InferenceSession>;
  lastUsed: number;
}

const sessions = new Map<string, CachedSession>();
const IDLE_RELEASE_MS = 10 * 60_000;
let sweeper: NodeJS.Timeout | null = null;

/** ISNet alone holds ~1 GB once loaded; drop sessions nobody used for a while. */
function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, cached] of sessions) {
      if (now - cached.lastUsed > IDLE_RELEASE_MS) {
        sessions.delete(key);
        void cached.session.then((s) => s.release()).catch(() => undefined);
      }
    }
  }, 60_000);
  sweeper.unref();
}

/** Returns a cached CPU inference session for a model file. */
export async function getSession(modelPath: string): Promise<InferenceSession> {
  const ort = await loadOrt();
  if (!ort) throw new Error('onnxruntime-node is not available');
  let cached = sessions.get(modelPath);
  if (!cached) {
    cached = {
      session: ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
      }),
      lastUsed: Date.now(),
    };
    sessions.set(modelPath, cached);
    ensureSweeper();
  }
  cached.lastUsed = Date.now();
  return cached.session;
}

export async function makeTensor(data: Float32Array, dims: number[]): Promise<Tensor> {
  const ort = await loadOrt();
  if (!ort) throw new Error('onnxruntime-node is not available');
  return new ort.Tensor('float32', data, dims);
}
