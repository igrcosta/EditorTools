import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PLAN_IDS, type ErrorCode } from '@editools/shared';
import { apiError } from '../media/errors';
import { CloudError } from './cloud';
import type { AccountService } from './service';

/**
 * The account API the web UI talks to. Tokens never appear in any response: the UI only ever sees
 * SessionInfo. (Host/Origin/header protection for these routes is in guard.ts.)
 */

const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Translates a failure of the backend into the API error the UI knows how to show. */
function sendCloudError(reply: FastifyReply, err: unknown, fallback: ErrorCode = 'download_failed'): FastifyReply {
  if (err instanceof CloudError) {
    const map: Record<CloudError['kind'], [number, ErrorCode]> = {
      network: [503, 'account_offline'],
      unauthorized: [401, 'unauthenticated'],
      rate_limited: [429, 'rate_limited'],
      forbidden: [403, 'forbidden'],
      invalid: [400, fallback],
    };
    const [status, code] = map[err.kind];
    return reply.code(status).send(apiError(code));
  }
  throw err;
}

export function registerAccountRoutes(app: FastifyInstance, account: AccountService): void {
  // The UI asks this first. With accounts off it answers "disabled" and nothing else exists.
  app.get('/api/session', async () => account.info());

  if (!account.enabled) return;

  // Polled by the UI after the user goes to pay; also how it learns about a plan change.
  app.get('/api/entitlements', async () => account.refreshEntitlements());

  app.post('/api/auth/request-code', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ email: emailSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('invalid_code'));
    try {
      await account.requestCode(parsed.data.email);
    } catch (err) {
      return sendCloudError(reply, err);
    }
    // Same answer whether or not the address already had an account.
    return reply.code(204).send();
  });

  app.post('/api/auth/verify-code', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('invalid_code'));
    try {
      return await account.verifyCode(parsed.data.email, parsed.data.code);
    } catch (err) {
      return sendCloudError(reply, err, 'invalid_code');
    }
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    await account.signOut();
    return reply.code(204).send();
  });

  app.post('/api/account/consent', async (request, reply) => {
    const parsed = z.object({ value: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('forbidden'));
    try {
      return await account.setConsent(parsed.data.value);
    } catch (err) {
      return sendCloudError(reply, err);
    }
  });

  // LGPD: everything stored about the account, as one JSON document.
  app.post('/api/account/export', async (_request, reply) => {
    try {
      return await account.exportData();
    } catch (err) {
      return sendCloudError(reply, err);
    }
  });

  // LGPD: erasure. Needs an explicit confirmation flag so a stray call cannot trigger it.
  app.post('/api/account/delete', async (request, reply) => {
    const parsed = z.object({ confirm: z.literal(true) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('forbidden'));
    try {
      await account.deleteAccount();
    } catch (err) {
      return sendCloudError(reply, err);
    }
    return reply.code(204).send();
  });

  // Dev tools. The database refuses anyone who is not an admin, whatever these routes accept.
  app.post('/api/admin/plan', async (request, reply) => {
    const parsed = z.object({ plan: z.enum(PLAN_IDS) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('forbidden'));
    try {
      return await account.adminSetPlan(parsed.data.plan);
    } catch (err) {
      return sendCloudError(reply, err);
    }
  });

  app.post('/api/admin/reset-quota', async (_request, reply) => {
    try {
      return await account.adminResetQuota();
    } catch (err) {
      return sendCloudError(reply, err);
    }
  });
}
