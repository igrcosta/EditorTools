import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { createCloudClient, type CloudClient } from './account/cloud';
import { registerPlanEnforcement } from './account/enforcement';
import { registerLocalGuard } from './account/guard';
import { parsePublicKey } from './account/limits';
import { registerAccountRoutes } from './account/routes';
import { AccountService, MemorySessionStore, type SessionStore } from './account/service';
import { apiError } from './media/errors';
import { setJobLogger, startSweeper } from './media/jobs';
import { registerAnalyzeRoute } from './routes/analyze';
import { registerAudioRoutes } from './routes/audio';
import { registerConvertRoute } from './routes/convert';
import { registerDownloadRoute } from './routes/download';
import { registerFeaturesRoute } from './routes/features';
import { registerImageRoutes } from './routes/image';
import { registerJobRoutes } from './routes/jobs';
import { registerVideoRoutes } from './routes/video';

export interface BuildAppOptions {
  /** Where the signed-in session is kept between launches. The desktop app encrypts it; the default is memory only. */
  sessionStore?: SessionStore;
  /** Replaces the Supabase client (tests). `null` turns accounts off whatever the configuration says. */
  cloud?: CloudClient | null;
}

/** How long startup waits for the stored session to be restored; a slow network must not delay the app. */
const SESSION_RESTORE_WAIT_MS = 4_000;

function buildAccountService(options: BuildAppOptions): AccountService {
  const cloud =
    options.cloud !== undefined
      ? options.cloud
      : config.accounts.enabled && config.accounts.supabaseUrl && config.accounts.supabaseAnonKey
        ? createCloudClient({ url: config.accounts.supabaseUrl, anonKey: config.accounts.supabaseAnonKey })
        : null;

  let publicKey = null;
  if (config.accounts.limitsPublicKey) {
    try {
      publicKey = parsePublicKey(config.accounts.limitsPublicKey);
    } catch {
      // A malformed key just means no offline grace; the app still works while online.
    }
  }
  return new AccountService({ cloud, store: options.sessionStore ?? new MemorySessionStore(), publicKey });
}

/**
 * Builds the Editools server without binding to a port.
 * Used by the standalone server entry (index.ts) and embedded by the desktop app.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.logFile ? { level: config.logLevel, file: config.logFile } : { level: config.logLevel },
    bodyLimit: 16 * 1024, // API requests are tiny JSON payloads
    trustProxy: config.trustProxy,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // Media thumbnails come from the source platforms (e.g. i.ytimg.com);
        // the image tools preview the local file before processing (blob:).
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        // Local files opened by the tools (waveform preview/playback) use blob: URLs.
        'media-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", 'blob:'],
        'worker-src': ["'self'", 'blob:'],
      },
    },
  });
  await app.register(cors, { origin: [...config.corsOrigins] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, {
    // fieldSize above busboy's 1MB default: captions' edited word-timing list
    // is plain-text JSON but can run long for longer videos.
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10, fieldSize: 8 * 1024 * 1024 },
  });

  // Accounts: the guard runs first (it protects every API route from other web pages), then the plan
  // enforcement for the tool routes. With accounts off, enforcement and the account routes are inert.
  const account = buildAccountService(options);
  registerLocalGuard(app, { enforceHost: config.loopbackOnly, allowedOrigins: config.corsOrigins });
  registerPlanEnforcement(app, account);

  app.get('/api/health', async () => ({ status: 'ok' }));
  registerAccountRoutes(app, account);

  registerFeaturesRoute(app);
  registerAnalyzeRoute(app);
  registerDownloadRoute(app);
  registerConvertRoute(app);
  registerAudioRoutes(app);
  registerImageRoutes(app);
  registerVideoRoutes(app);
  registerJobRoutes(app);

  // Single-port deploy: serve the built web app alongside the API.
  if (config.webDist) {
    await app.register(fastifyStatic, { root: path.resolve(config.webDist) });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) {
        return reply.sendFile('index.html'); // SPA fallback
      }
      return reply.code(404).send(apiError('not_found'));
    });
  }

  setJobLogger(app.log);
  startSweeper();

  // Restore the previous session, but do not hold the app hostage to a slow connection: if it takes
  // longer than this the UI simply sees the state change when it polls /api/session.
  await Promise.race([account.init(), new Promise((resolve) => setTimeout(resolve, SESSION_RESTORE_WAIT_MS).unref())]);

  return app;
}
