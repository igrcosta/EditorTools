import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config';
import { apiError } from './media/errors';
import { setJobLogger, startSweeper } from './media/jobs';
import { registerAnalyzeRoute } from './routes/analyze';
import { registerDownloadRoute } from './routes/download';
import { registerJobRoutes } from './routes/jobs';

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

app.get('/api/health', async () => ({ status: 'ok' }));

registerAnalyzeRoute(app);
registerDownloadRoute(app);
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

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
