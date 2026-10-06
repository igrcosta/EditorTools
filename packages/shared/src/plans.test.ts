import { describe, expect, it } from 'vitest';
import {
  COUNTED_TOOLS,
  DEFAULT_PLAN_LIMITS,
  TOOL_IDS,
  effectiveCap,
  evaluateLimits,
  isCountedTool,
  limitsPayloadMessage,
  toolForRequest,
  type LimitsPayload,
} from './plans';

describe('toolForRequest', () => {
  it('maps every tool route to its id', () => {
    const cases: Array<[string, string]> = [
      ['/api/download', 'download'],
      ['/api/convert', 'convert'],
      ['/api/audio/fix', 'audio_fix'],
      ['/api/audio/timeline/analyze', 'silence_analyze'],
      ['/api/audio/timeline/cut', 'silence_cut'],
      ['/api/image/remove-background', 'remove_background'],
      ['/api/image/upscale', 'upscale'],
      ['/api/video/face-track', 'face_track'],
      ['/api/video/captions/transcribe', 'captions_transcribe'],
      ['/api/video/captions/render', 'captions_render'],
    ];
    for (const [path, tool] of cases) expect(toolForRequest('POST', path)).toBe(tool);
    // no tool id is left without a route
    expect(new Set(cases.map(([, t]) => t))).toEqual(new Set(TOOL_IDS));
  });

  it('ignores query strings, trailing slashes and method case', () => {
    expect(toolForRequest('post', '/api/convert?x=1')).toBe('convert');
    expect(toolForRequest('POST', '/api/convert/')).toBe('convert');
  });

  it('is null for anything that is not a tool start', () => {
    expect(toolForRequest('GET', '/api/convert')).toBeNull();
    expect(toolForRequest('POST', '/api/analyze')).toBeNull(); // the sync metadata call is not a job
    expect(toolForRequest('POST', '/api/jobs/abc')).toBeNull();
    expect(toolForRequest('POST', '/api/convert/extra')).toBeNull();
    expect(toolForRequest('POST', '/api/auth/request-code')).toBeNull();
  });
});

describe('counted tools', () => {
  it('leaves the preview steps free and counts the real work', () => {
    expect(isCountedTool('silence_analyze')).toBe(false);
    expect(isCountedTool('captions_transcribe')).toBe(false);
    expect(isCountedTool('silence_cut')).toBe(true);
    expect(isCountedTool('captions_render')).toBe(true);
    expect(COUNTED_TOOLS.size).toBe(TOOL_IDS.length - 2);
  });
});

describe('evaluateLimits', () => {
  const free = DEFAULT_PLAN_LIMITS.free;
  const pro = DEFAULT_PLAN_LIMITS.pro;

  it('lets a request inside every limit through', () => {
    expect(evaluateLimits(free, { mediaSeconds: 300, uploadBytes: 500 * 1024 * 1024, downloadHeight: 720, upscaleScale: 2 })).toEqual({
      ok: true,
    });
  });

  it('checks only what the request carries', () => {
    expect(evaluateLimits(free, {})).toEqual({ ok: true });
  });

  it('rejects over-long media', () => {
    expect(evaluateLimits(free, { mediaSeconds: 301 })).toEqual({ ok: false, limit: 'maxMediaSeconds', max: 300 });
  });

  it('rejects oversized uploads', () => {
    expect(evaluateLimits(free, { uploadBytes: 500 * 1024 * 1024 + 1 })).toMatchObject({ ok: false, limit: 'maxUploadBytes' });
  });

  it('rejects a download taller than the plan allows', () => {
    expect(evaluateLimits(free, { downloadHeight: 1080 })).toMatchObject({ ok: false, limit: 'maxDownloadHeight', max: 720 });
    expect(evaluateLimits(free, { downloadHeight: 720 })).toEqual({ ok: true });
  });

  it('only allows the upscale factors in the plan', () => {
    expect(evaluateLimits(free, { upscaleScale: 4 })).toMatchObject({ ok: false, limit: 'allowedUpscaleScales' });
    expect(evaluateLimits(free, { upscaleScale: 2 })).toEqual({ ok: true });
  });

  it('pro has no plan-specific limits', () => {
    expect(evaluateLimits(pro, { mediaSeconds: 99999, uploadBytes: 1e12, downloadHeight: 4320, upscaleScale: 4 })).toEqual({ ok: true });
  });
});

describe('effectiveCap', () => {
  it('uses the global cap when the plan has none, and the smaller of the two otherwise', () => {
    expect(effectiveCap(1800, null)).toBe(1800);
    expect(effectiveCap(1800, 300)).toBe(300);
    expect(effectiveCap(200, 300)).toBe(200);
  });
});

describe('limitsPayloadMessage', () => {
  const base: LimitsPayload = {
    sub: 'user-1',
    plan: 'free',
    limits: DEFAULT_PLAN_LIMITS.free,
    iat: 1_700_000_000,
    exp: 1_700_604_800,
  };

  it('is deterministic and independent of property order', () => {
    const reordered: LimitsPayload = {
      exp: base.exp,
      iat: base.iat,
      limits: {
        allowedUpscaleScales: base.limits.allowedUpscaleScales,
        maxDownloadHeight: base.limits.maxDownloadHeight,
        maxUploadBytes: base.limits.maxUploadBytes,
        maxMediaSeconds: base.limits.maxMediaSeconds,
        dailyRuns: base.limits.dailyRuns,
      },
      plan: base.plan,
      sub: base.sub,
    };
    expect(limitsPayloadMessage(reordered)).toBe(limitsPayloadMessage(base));
  });

  it('changes when any signed field changes', () => {
    const m = limitsPayloadMessage(base);
    expect(limitsPayloadMessage({ ...base, sub: 'user-2' })).not.toBe(m);
    expect(limitsPayloadMessage({ ...base, plan: 'pro' })).not.toBe(m);
    expect(limitsPayloadMessage({ ...base, exp: base.exp + 1 })).not.toBe(m);
    expect(limitsPayloadMessage({ ...base, limits: { ...base.limits, dailyRuns: 11 } })).not.toBe(m);
  });
});
