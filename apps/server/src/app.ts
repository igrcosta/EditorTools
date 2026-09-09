import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { apiError } from './media/errors';
import { setJobLogger, startSweeper } from './media/jobs';
import { registerAnalyzeRoute } from './routes/analyze';
import { registerAudioRoutes } from './routes/audio';
import { registerConvertRoute } from './routes/convert';
import { registerDownloadRoute } from './routes/download';
import { registerJobRoutes } from './routes/jobs';

/**
 * Builds the Editools server without binding to a port.
 * Used by the standalone server entry (index.ts) and embedded by the desktop app.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 16 * 1024, // API requests are tiny JSON payloads
    trustProxy: config.trustProxy,
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        // Media thumbnails come from the source platforms (e.g. i.ytimg.com).
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  });
  await app.register(cors, { origin: [...config.corsOrigins] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 },
  });

  app.get('/api/health', async () => ({ status: 'ok' }));

  registerAnalyzeRoute(app);
  registerDownloadRoute(app);
  registerConvertRoute(app);
  registerAudioRoutes(app);
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

  return app;
}
