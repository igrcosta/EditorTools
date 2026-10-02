import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

/**
 * Runs wav2vec2 inference for the forced aligner on a worker thread.
 *
 * onnxruntime-node's `session.run()` is a synchronous native call (its JS wrapper only defers the
 * start with setImmediate), so on the main thread one 20 s window froze the whole server for
 * 10+ seconds: progress polls and the Cancel button stalled until it returned. In a worker the
 * main thread stays free.
 *
 * The worker's code is inlined as a string rather than shipped as a file, so it works unchanged
 * under tsx (dev), the esbuild bundle and the packaged Electron app. It can't `require` by bare
 * name from an eval'd script, so it resolves onnxruntime-node from a base path instead: the app's
 * resources folder when packaged (where extraResources puts node_modules), the working directory
 * (inside the repo) in development.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { createRequire } = require('node:module');
const ort = createRequire(workerData.base)('onnxruntime-node');
let session = null;
parentPort.on('message', async (msg) => {
  try {
    if (msg.type === 'load') {
      session = await ort.InferenceSession.create(msg.model, {
        executionProviders: ['cpu'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: msg.threads,
      });
      parentPort.postMessage({ id: msg.id, ok: true });
    } else {
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', msg.input, [1, msg.input.length]) });
      const logits = out[session.outputNames[0]];
      const dims = logits.dims;
      const data = new Float32Array(logits.data);
      parentPort.postMessage({ id: msg.id, ok: true, frames: dims[1], vocabSize: dims[2], data }, [data.buffer]);
    }
  } catch (e) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((e && e.message) || e) });
  }
});
`;

/** Leave a couple of cores for the UI and the rest of the server. */
const ORT_THREADS = Math.max(2, Math.min(6, os.availableParallelism() - 2));
const IDLE_RELEASE_MS = 10 * 60_000;

export interface Emission {
  /** Frames × vocabSize raw logits, row-major. */
  data: Float32Array;
  frames: number;
  vocabSize: number;
}

export interface EmissionClient {
  run(input: Float32Array): Promise<Emission>;
}

interface Pending {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}

class WorkerEmissionClient implements EmissionClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | null = null;
  dead = false;

  constructor(
    private readonly modelFile: string,
    private readonly onDispose: () => void,
  ) {
    const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const base = path.join(resources ?? process.cwd(), 'noop.js');
    this.worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { base } });
    this.worker.on('message', (msg: Record<string, unknown> & { id: number }) => {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (!p) return;
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(String(msg.error)));
    });
    const fail = (err: Error) => {
      this.dead = true;
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
      this.onDispose();
    };
    this.worker.on('error', fail);
    this.worker.on('exit', (code) => fail(new Error(`aligner worker exited (${code})`)));
    this.worker.unref();
  }

  private call(message: Record<string, unknown>, transfer: ArrayBuffer[] = []): Promise<Record<string, unknown>> {
    if (this.dead) return Promise.reject(new Error('aligner worker is not running'));
    this.touch();
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, ...message }, transfer);
    });
  }

  async load(): Promise<void> {
    await this.call({ type: 'load', model: this.modelFile, threads: ORT_THREADS });
  }

  async run(input: Float32Array): Promise<Emission> {
    const msg = await this.call({ type: 'run', input }, [input.buffer as ArrayBuffer]);
    this.touch();
    return { data: msg.data as Float32Array, frames: msg.frames as number, vocabSize: msg.vocabSize as number };
  }

  /** The model holds a few hundred MB; free it once nobody has aligned anything for a while. */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.worker.terminate(), IDLE_RELEASE_MS);
    this.idleTimer.unref();
  }
}

const clients = new Map<string, Promise<WorkerEmissionClient>>();

/** A loaded worker for this model file, created on first use and shared by every job. */
export function getEmissionClient(modelFile: string): Promise<EmissionClient> {
  let client = clients.get(modelFile);
  if (!client) {
    client = (async () => {
      const created = new WorkerEmissionClient(modelFile, () => clients.delete(modelFile));
      try {
        await created.load();
      } catch (err) {
        clients.delete(modelFile);
        throw err;
      }
      return created;
    })();
    clients.set(modelFile, client);
  }
  return client;
}
