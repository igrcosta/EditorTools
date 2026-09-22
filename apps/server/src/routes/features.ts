import type { FastifyInstance } from 'fastify';
import type { FeaturesResponse } from '@editools/shared';
import { getFeatures } from '../media/features';

/** Tells the web app which optional (desktop-only) tools this server can run. */
export function registerFeaturesRoute(app: FastifyInstance): void {
  app.get('/api/features', async (): Promise<FeaturesResponse> => getFeatures(app.log));
}
