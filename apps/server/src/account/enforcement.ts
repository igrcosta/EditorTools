import { rm } from 'node:fs/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  effectiveCap,
  evaluateLimits,
  toolForRequest,
  type ErrorCode,
  type LimitCheck,
  type LimitRequest,
  type PlanLimits,
  type ToolId,
} from '@editools/shared';
import { apiError } from '../media/errors';
import { probeMedia } from '../media/ffmpeg';
import { onJobFinished, type JobContext } from '../media/jobs';
import type { AccountService } from './service';

/**
 * Applies the signed-in user's plan to the tool routes.
 *
 * - An `onRequest` hook runs BEFORE the upload body is read, so a signed-out user, an exhausted
 *   quota or an oversized upload is refused without streaming gigabytes to disk first.
 * - A counted tool takes one run of today's quota there. The run belongs to the request until a job
 *   is created (createJob marks it `committed`); if the request ends without one — invalid body,
 *   server busy, upload too large, a crash — the `onResponse` hook gives the run back. Once a job
 *   owns it, a failed or canceled job gives it back (see onJobFinished below). A success keeps it.
 * - Routes read the plan's per-job limits through the helpers at the bottom.
 *
 * Everything is a no-op while accounts are not configured, so the web demo and plain `npm run dev`
 * behave exactly as before.
 */

/** The plan context attached to a request: also the object handed to createJob as its JobContext. */
export interface RequestPlan extends JobContext {
  limits: PlanLimits;
}

declare module 'fastify' {
  interface FastifyRequest {
    plan: RequestPlan | null;
  }
}

const STATUS_FOR: Partial<Record<ErrorCode, number>> = {
  unauthenticated: 401,
  plan_limit: 403,
  quota_exceeded: 429,
  account_offline: 503,
};

export function sendPlanError(reply: FastifyReply, code: ErrorCode, details?: Parameters<typeof apiError>[1]): FastifyReply {
  return reply.code(STATUS_FOR[code] ?? 403).send(apiError(code, details));
}

/** A rejected LimitCheck, as the API error the UI turns into an upgrade prompt. */
export function sendLimit(reply: FastifyReply, check: Extract<LimitCheck, { ok: false }>): FastifyReply {
  return sendPlanError(reply, 'plan_limit', { limit: check.limit, max: check.max });
}

const UPLOAD_TOOLS = new Set<ToolId>([
  'convert',
  'audio_fix',
  'silence_analyze',
  'silence_cut',
  'remove_background',
  'upscale',
  'face_track',
  'captions_transcribe',
  'captions_render',
]);

export function registerPlanEnforcement(app: FastifyInstance, account: AccountService): void {
  app.decorateRequest('plan', null);

  app.addHook('onRequest', async (request, reply) => {
    if (!account.enabled) return;
    const path = request.url.split('?')[0];
    const tool = toolForRequest(request.method, request.url);
    // /api/analyze is not a job, but it is still the account's feature: signed-in users only.
    const isAnalyze = request.method === 'POST' && path === '/api/analyze';
    if (!tool && !isAnalyze) return;

    const info = account.info();
    if (info.state === 'unreachable') return sendPlanError(reply, 'account_offline');
    if (info.state !== 'authenticated') return sendPlanError(reply, 'unauthenticated');
    const limits = account.limits();
    if (!limits) return sendPlanError(reply, 'unauthenticated');

    if (tool && UPLOAD_TOOLS.has(tool)) {
      // The upload size is known from the request line, before a single byte of the body is read.
      const declared = Number(request.headers['content-length']);
      if (Number.isFinite(declared)) {
        const check = evaluateLimits(limits, { uploadBytes: declared });
        if (!check.ok) return sendLimit(reply, check);
      }
    }
    if (!tool) return;

    const reserved = await account.reserveRun(tool);
    if (!reserved.ok) {
      return sendPlanError(reply, reserved.code, reserved.resetsAt ? { resetsAt: reserved.resetsAt } : undefined);
    }
    request.plan = {
      tool,
      userId: account.currentUserId() ?? '',
      limits,
      reservationId: reserved.reservationId,
      committed: false,
    };
  });

  // The request ended. If it never became a job, the reserved run goes back to the user.
  app.addHook('onResponse', async (request) => {
    const plan = request.plan;
    if (plan && plan.reservationId && !plan.committed) await account.releaseRun(plan.reservationId);
  });

  // A job that failed or was canceled gives its run back; one that succeeded keeps it.
  onJobFinished((job) => {
    const ctx = job.context;
    if (job.status === 'error' && ctx?.reservationId) void account.releaseRun(ctx.reservationId);
  });
}

// ---------------------------------------------------------------------------
// Helpers for the routes
// ---------------------------------------------------------------------------

/** The plan's per-job limits for this request; null when accounts are off (then only the global caps apply). */
export function limitsOf(request: FastifyRequest): PlanLimits | null {
  return request.plan?.limits ?? null;
}

/** The context to pass to createJob, so the job owns the quota run. Undefined when accounts are off. */
export function planContext(request: FastifyRequest): RequestPlan | undefined {
  return request.plan ?? undefined;
}

/** Upload cap for this request: the server's global cap, tightened by the plan's. */
export function uploadCap(request: FastifyRequest, globalCap: number): number {
  return effectiveCap(globalCap, limitsOf(request)?.maxUploadBytes ?? null);
}

/** Plan check for a value the route only learns after parsing the request. Passes when accounts are off. */
export function checkPlan(request: FastifyRequest, req: LimitRequest): LimitCheck {
  const limits = limitsOf(request);
  return limits ? evaluateLimits(limits, req) : { ok: true };
}

/**
 * Probes the uploaded media and checks its duration against the plan. Skipped (no probe) when the
 * plan has no duration limit. A file that cannot be probed passes here and fails properly later.
 */
export async function checkPlanMediaDuration(request: FastifyRequest, inputPath: string): Promise<LimitCheck> {
  const limits = limitsOf(request);
  if (!limits || limits.maxMediaSeconds === null) return { ok: true };
  const probe = await probeMedia(inputPath).done.catch(() => null);
  if (!probe || !probe.duration) return { ok: true };
  return evaluateLimits(limits, { mediaSeconds: probe.duration });
}

/**
 * Refuses the request if the uploaded media is longer than the plan allows, removing the staged
 * upload. Returns the sent reply to `return` from the route, or null when the media is fine.
 */
export async function rejectOverPlanDuration(
  request: FastifyRequest,
  reply: FastifyReply,
  tempDir: string,
  inputPath: string,
): Promise<FastifyReply | null> {
  const check = await checkPlanMediaDuration(request, inputPath);
  if (check.ok) return null;
  await rm(tempDir, { recursive: true, force: true });
  return sendLimit(reply, check);
}

/** Same, for a plan check on a parsed option (e.g. the upscale factor). */
export async function rejectOverPlan(
  request: FastifyRequest,
  reply: FastifyReply,
  tempDir: string,
  req: LimitRequest,
): Promise<FastifyReply | null> {
  const check = checkPlan(request, req);
  if (check.ok) return null;
  await rm(tempDir, { recursive: true, force: true });
  return sendLimit(reply, check);
}
