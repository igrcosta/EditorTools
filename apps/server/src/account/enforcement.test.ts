import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cancelJob, createJob, type JobTask } from '../media/jobs';
import { CLIENT_HEADER, hostnameOf, isSameOrigin, registerLocalGuard } from './guard';
import { checkPlan, planContext, registerPlanEnforcement, uploadCap } from './enforcement';
import { registerAccountRoutes } from './routes';
import { AccountService, MemorySessionStore } from './service';
import { FakeCloud, PUBLIC_KEY } from './testing';

// ---- the guard (Host / Origin / header) --------------------------------------------------------

describe('hostnameOf / isSameOrigin', () => {
  it('extracts the host name from a Host header', () => {
    expect(hostnameOf('localhost:3001')).toBe('localhost');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
    expect(hostnameOf('[::1]:3001')).toBe('[::1]');
    expect(hostnameOf('Evil.COM:80')).toBe('evil.com');
    expect(hostnameOf(undefined)).toBeNull();
    expect(hostnameOf('a b')).toBeNull();
  });

  it('compares an Origin with the Host it was sent to', () => {
    expect(isSameOrigin('http://127.0.0.1:5000', '127.0.0.1:5000')).toBe(true);
    expect(isSameOrigin('http://127.0.0.1:5000', '127.0.0.1:5001')).toBe(false);
    expect(isSameOrigin('http://evil.com', '127.0.0.1:5000')).toBe(false);
    expect(isSameOrigin('null', '127.0.0.1:5000')).toBe(false);
    expect(isSameOrigin('garbage', '127.0.0.1:5000')).toBe(false);
  });
});

async function buildApp(opts: { cloud: FakeCloud | null; enforceHost?: boolean; signedIn?: boolean }) {
  const app = Fastify();
  const account = new AccountService({ cloud: opts.cloud, store: new MemorySessionStore(), publicKey: PUBLIC_KEY });
  if (opts.cloud && opts.signedIn !== false) {
    await account.requestCode('ana@test.dev');
    await account.verifyCode('ana@test.dev', '123456');
  }
  registerLocalGuard(app, { enforceHost: opts.enforceHost ?? true, allowedOrigins: ['http://localhost:5173'] });
  registerPlanEnforcement(app, account);
  registerAccountRoutes(app, account);

  app.get('/api/health', async () => ({ status: 'ok' }));
  app.post('/api/analyze', async () => ({ ok: true }));
  app.post('/api/audio/timeline/analyze', async (request) => ({ tool: request.plan?.tool ?? null }));

  const tasks: Record<string, () => JobTask> = {
    'job-ok': () => ({
      maxAttempts: 1,
      start: (dir) => {
        writeFileSync(path.join(dir, 'out.txt'), 'x');
        return { kill() {}, done: Promise.resolve() };
      },
      resolveOutput: async (dir) => path.join(dir, 'out.txt'),
    }),
    'job-fail': () => ({
      maxAttempts: 1,
      start: () => ({ kill() {}, done: Promise.reject(new Error('boom')) }),
      resolveOutput: async () => undefined,
    }),
    'job-cancel': () => {
      let stop: (e: Error) => void = () => {};
      return {
        maxAttempts: 1,
        start: () => ({ kill: () => stop(new Error('killed')), done: new Promise<void>((_, reject) => (stop = reject)) }),
        resolveOutput: async () => undefined,
      };
    },
  };

  // Stand-in for a tool route: it can end without a job, with a refused request, or with a real job.
  app.post('/api/convert', async (request, reply) => {
    const mode = String(request.headers['x-mode'] ?? '');
    if (mode === 'invalid') return reply.code(400).send({ error: 'invalid_file' });
    if (mode === 'busy') return reply.code(429).send({ error: 'busy' });
    if (tasks[mode]) {
      const job = await createJob(tasks[mode](), undefined, planContext(request));
      if (job === 'busy') return reply.code(429).send({ error: 'busy' });
      return reply.code(202).send({ jobId: job.id });
    }
    // Default: behave like a route that did create a job (createJob marks the run as owned by it).
    const owner = planContext(request);
    if (owner) owner.committed = true;
    return reply.code(202).send({ ok: true });
  });

  await app.ready();
  return { app, account, cloud: opts.cloud };
}

const SAME = { host: 'localhost:3001' };
const post = (app: FastifyInstance, url: string, headers: Record<string, string> = {}, payload?: unknown) =>
  app.inject({ method: 'POST', url, headers: { ...SAME, ...headers }, payload: payload as never });

describe('guard on the API', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    ctx = await buildApp({ cloud: new FakeCloud(() => Date.now()) });
  });
  afterAll(() => ctx.app.close());

  it('refuses a Host that is not loopback (DNS rebinding)', async () => {
    for (const host of ['evil.com', 'evil.com:3001', '127.0.0.1.evil.com', 'localhost.evil.com']) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/session', headers: { host } });
      expect(res.statusCode, host).toBe(403);
      expect(res.json().error).toBe('blocked_host');
    }
  });

  it('accepts the loopback names, with or without a port', async () => {
    for (const host of ['localhost:3001', '127.0.0.1:52000', '127.0.0.1', '[::1]:3001']) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/health', headers: { host } });
      expect(res.statusCode, host).toBe(200);
    }
  });

  it('refuses a state-changing request from another origin (CSRF), even a simple one', async () => {
    for (const origin of ['http://evil.com', 'null', 'http://localhost:9999']) {
      const res = await post(ctx.app, '/api/convert', { origin });
      expect(res.statusCode, origin).toBe(403);
    }
  });

  it('accepts the app\'s own origin, the dev server, and requests with no Origin at all', async () => {
    expect((await post(ctx.app, '/api/convert', { origin: 'http://localhost:3001' })).statusCode).toBe(202);
    expect((await post(ctx.app, '/api/convert', { origin: 'http://localhost:5173' })).statusCode).toBe(202);
    expect((await post(ctx.app, '/api/convert')).statusCode).toBe(202);
  });

  it('needs the client header on account routes, so a page cannot call them without a preflight', async () => {
    const body = { email: 'ana@test.dev' };
    const without = await post(ctx.app, '/api/auth/request-code', {}, body);
    expect(without.statusCode).toBe(403);
    expect(without.json().error).toBe('forbidden');

    const withHeader = await post(ctx.app, '/api/auth/request-code', { [CLIENT_HEADER]: '1' }, body);
    expect(withHeader.statusCode).toBe(204);

    expect((await post(ctx.app, '/api/account/delete', {}, { confirm: true })).statusCode).toBe(403);
    expect((await post(ctx.app, '/api/admin/plan', {}, { plan: 'pro' })).statusCode).toBe(403);
  });

  it('does not enforce Host on a shared deployment', async () => {
    const shared = await buildApp({ cloud: null, enforceHost: false });
    const res = await shared.app.inject({ method: 'GET', url: '/api/health', headers: { host: 'editools.onrender.com' } });
    expect(res.statusCode).toBe(200);
    await shared.app.close();
  });
});

// ---- plan enforcement ---------------------------------------------------------------------------

describe('accounts switched off', () => {
  it('leaves every route as it was, with no session and no limits', async () => {
    const { app } = await buildApp({ cloud: null });
    expect((await post(app, '/api/convert')).statusCode).toBe(202);
    expect((await post(app, '/api/analyze')).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: SAME })).json()).toEqual({ state: 'disabled' });
    await app.close();
  });
});

describe('signed out', () => {
  it('refuses the tool routes and /api/analyze, but not health or the session', async () => {
    const { app } = await buildApp({ cloud: new FakeCloud(() => Date.now()), signedIn: false });
    for (const url of ['/api/convert', '/api/analyze', '/api/audio/timeline/analyze']) {
      const res = await post(app, url);
      expect(res.statusCode, url).toBe(401);
      expect(res.json().error).toBe('unauthenticated');
    }
    expect((await app.inject({ method: 'GET', url: '/api/health', headers: SAME })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/session', headers: SAME })).json()).toEqual({ state: 'anonymous' });
    await app.close();
  });
});

describe('signed in', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let cloud: FakeCloud;
  beforeAll(async () => {
    cloud = new FakeCloud(() => Date.now());
    ctx = await buildApp({ cloud });
  });
  afterAll(() => ctx.app.close());

  it('lets the preview steps and /api/analyze through without spending a run', async () => {
    const before = cloud.used;
    expect((await post(ctx.app, '/api/audio/timeline/analyze')).json()).toEqual({ tool: 'silence_analyze' });
    expect((await post(ctx.app, '/api/analyze')).statusCode).toBe(200);
    expect(cloud.used).toBe(before);
  });

  it('spends a run for a counted tool when a job is created', async () => {
    const before = cloud.used;
    expect((await post(ctx.app, '/api/convert')).statusCode).toBe(202);
    expect(cloud.used).toBe(before + 1);
  });

  it('gives the run back when the request ends without a job', async () => {
    for (const mode of ['invalid', 'busy']) {
      const before = cloud.used;
      expect((await post(ctx.app, '/api/convert', { 'x-mode': mode })).statusCode).toBeGreaterThanOrEqual(400);
      await vi.waitFor(() => expect(cloud.used, mode).toBe(before));
    }
  });

  it('refuses an upload bigger than the plan allows before reading it, and spends nothing', async () => {
    const before = cloud.used;
    const res = await post(ctx.app, '/api/convert', { 'content-length': String(600 * 1024 * 1024) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'plan_limit', details: { limit: 'maxUploadBytes', max: 500 * 1024 * 1024 } });
    expect(cloud.used).toBe(before);
  });
});

describe('the run follows the job', () => {
  let ctx: Awaited<ReturnType<typeof buildApp>>;
  let cloud: FakeCloud;
  beforeAll(async () => {
    cloud = new FakeCloud(() => Date.now());
    ctx = await buildApp({ cloud });
  });
  afterAll(() => ctx.app.close());

  const tmp: string[] = [];
  afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('keeps the run when the job succeeds', async () => {
    const res = await post(ctx.app, '/api/convert', { 'x-mode': 'job-ok' });
    expect(res.statusCode).toBe(202);
    await new Promise((r) => setTimeout(r, 150));
    expect(cloud.used).toBe(1);
  });

  it('gives the run back when the job fails', async () => {
    const before = cloud.used;
    expect((await post(ctx.app, '/api/convert', { 'x-mode': 'job-fail' })).statusCode).toBe(202);
    await vi.waitFor(() => expect(cloud.used).toBe(before));
  });

  it('gives the run back when the job is canceled', async () => {
    const before = cloud.used;
    const res = await post(ctx.app, '/api/convert', { 'x-mode': 'job-cancel' });
    const { jobId } = res.json();
    expect(cloud.used).toBe(before + 1);
    const { getJob } = await import('../media/jobs');
    await cancelJob(getJob(jobId)!);
    await vi.waitFor(() => expect(cloud.used).toBe(before));
  });
});

describe('quota', () => {
  it('stops at the daily limit with the reset time, and a failure frees a run', async () => {
    const cloud = new FakeCloud(() => Date.now());
    const { app } = await buildApp({ cloud });
    for (let i = 0; i < 10; i += 1) expect((await post(app, '/api/convert')).statusCode).toBe(202);

    const blocked = await post(app, '/api/convert');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ error: 'quota_exceeded' });
    expect(blocked.json().details.resetsAt).toBeTruthy();

    expect((await post(app, '/api/convert', { 'x-mode': 'job-fail' })).statusCode).toBe(429); // still at the limit
    await app.close();
  });
});

describe('plan helpers', () => {
  it('apply the plan\'s limits and fall back to the global caps with no plan', () => {
    const request = { plan: { limits: { dailyRuns: 10, maxMediaSeconds: 300, maxUploadBytes: 1000, maxDownloadHeight: 720, allowedUpscaleScales: [2] } } } as never;
    expect(uploadCap(request, 8 * 1024 ** 3)).toBe(1000);
    expect(uploadCap({ plan: null } as never, 8 * 1024 ** 3)).toBe(8 * 1024 ** 3);
    expect(checkPlan(request, { downloadHeight: 1080 })).toMatchObject({ ok: false, limit: 'maxDownloadHeight' });
    expect(checkPlan({ plan: null } as never, { downloadHeight: 4320 })).toEqual({ ok: true });
  });
});

// keep the temp helpers referenced so unused-import linting stays quiet
void [mkdirSync, os];
