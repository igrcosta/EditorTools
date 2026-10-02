import type { ComponentType, CSSProperties } from 'react';

/**
 * Looping, CSS-only illustrations of what each tool does, for the landing page.
 * They are decorative (aria-hidden) and never show numbers or progress: nothing here
 * pretends to be a real job. Each one fills its (relatively positioned) container.
 * Pausing off-screen is handled by the `.demo-paused` class on an ancestor.
 */

export type DemoKey = 'files' | 'audio' | 'image' | 'video' | 'captions';

/* ───────── Audio: silences turn grey, then collapse out of the timeline ───────── */

const WAVE_BARS = 46;
const SILENT_RANGES: ReadonlyArray<readonly [number, number]> = [
  [12, 19],
  [30, 36],
];

function barHeight(i: number, silent: boolean): number {
  if (silent) return 7 + ((i * 5) % 6);
  const swell = Math.abs(Math.sin(i * 0.55) * 0.55 + Math.sin(i * 1.7) * 0.3);
  return 24 + Math.round(swell * 60);
}

function AudioDemo() {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-6">
      <div className="relative flex h-3/5 items-center">
        {Array.from({ length: WAVE_BARS }, (_, i) => {
          const silent = SILENT_RANGES.some(([from, to]) => i >= from && i <= to);
          return (
            <span
              key={i}
              className={`block rounded-full ${silent ? 'demo-wave-silent' : ''}`}
              style={{
                width: 5,
                marginInline: 1.5,
                height: `${barHeight(i, silent)}%`,
                background: 'rgba(176,131,255,0.85)',
                animationDelay: silent ? `${(i % 4) * 40}ms` : undefined,
              }}
            />
          );
        })}
        <span
          className="absolute inset-y-[-12%] w-0.5 rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,0.8)]"
          style={{ animation: 'demo-playhead 6s linear infinite' }}
        />
      </div>
    </div>
  );
}

/* ───────── Captions: karaoke words over a "video" frame ───────── */

const CAPTION_WORDS = ['MAKE', 'EVERY', 'WORD', 'COUNT'];

function CaptionsDemo() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[radial-gradient(ellipse_at_30%_20%,rgba(145,70,255,0.35),transparent_60%),linear-gradient(180deg,#14141b,#0a0a0e)]">
      <div className="absolute inset-x-0 bottom-[16%] flex flex-wrap justify-center gap-x-3 px-6 [text-shadow:0_3px_0_rgba(0,0,0,0.6)]">
        {CAPTION_WORDS.map((word, i) => (
          <span
            key={word}
            className="inline-block text-[clamp(1.4rem,3.4vw,2.6rem)] leading-none tracking-wide text-white"
            style={
              {
                fontFamily: "'Anton', 'Space Grotesk Variable', sans-serif",
                animation: 'demo-word 2.8s ease-out infinite',
                animationDelay: `${i * 0.7}s`,
              } as CSSProperties
            }
          >
            {word}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ───────── Face Tracking: a 9:16 crop follows the face across a 16:9 shot ───────── */

function VideoDemo() {
  const follow = { animation: 'demo-reframe 7s ease-in-out infinite' } as CSSProperties;
  return (
    <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(135deg,#17151f,#0b0b10)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_90%,rgba(145,70,255,0.18),transparent_55%)]" />
      {/* the face */}
      <div className="absolute top-[24%] h-[56%] w-[11%] -translate-x-1/2" style={follow}>
        <span className="absolute top-0 left-1/2 aspect-square w-[78%] -translate-x-1/2 rounded-full bg-zinc-300/90" />
        <span className="absolute bottom-0 left-1/2 h-[42%] w-full -translate-x-1/2 rounded-t-full bg-zinc-500/80" />
      </div>
      {/* the crop that follows it */}
      <div
        className="absolute top-[6%] h-[88%] aspect-[9/16] -translate-x-1/2 rounded-md border-2 border-accent-text shadow-[0_0_0_999px_rgba(0,0,0,0.58)]"
        style={follow}
      >
        <span className="absolute -top-px left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-white">
          9:16
        </span>
      </div>
    </div>
  );
}

/* ───────── Image: before/after divider sweeping across a cut-out ───────── */

function Subject() {
  return (
    <div className="absolute bottom-0 left-1/2 h-[78%] w-[34%] -translate-x-1/2">
      <span className="absolute top-0 left-1/2 aspect-square w-[46%] -translate-x-1/2 rounded-full bg-zinc-300" />
      <span className="absolute bottom-0 left-1/2 h-[52%] w-full -translate-x-1/2 rounded-t-[999px] bg-accent/80" />
    </div>
  );
}

function ImageDemo() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* before: busy background */}
      <div className="absolute inset-0 bg-[repeating-linear-gradient(115deg,#1d1b27_0_14px,#2a2540_14px_28px)]" />
      <Subject />
      {/* after: same subject, background removed → checkerboard */}
      <div className="checkerboard absolute inset-0" style={{ animation: 'demo-compare 6s ease-in-out infinite' }}>
        <Subject />
      </div>
      <span
        className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_16px_rgba(255,255,255,0.7)]"
        style={{ animation: 'demo-compare-bar 6s ease-in-out infinite' }}
      />
    </div>
  );
}

/* ───────── Files: paste a link, pick a format ───────── */

const FORMAT_CHIPS = ['MP4', 'MOV', 'WEBM', 'MP3'];

function FilesDemo() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8">
      <div className="flex h-11 w-full max-w-sm items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4">
        <i className="fi-rr-link text-sm text-accent-text" aria-hidden="true" />
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <span
            className="block overflow-hidden whitespace-nowrap font-mono text-xs text-zinc-300"
            style={{ animation: 'demo-type 5s steps(26, end) infinite alternate' }}
          >
            https://youtu.be/your-video
          </span>
        </div>
        <span className="h-4 w-px animate-pulse bg-accent-text" />
      </div>
      <i className="fi-rr-arrow-down text-zinc-600" aria-hidden="true" />
      <div className="flex gap-2">
        {FORMAT_CHIPS.map((chip, i) => (
          <span
            key={chip}
            className="rounded-md border border-white/10 px-3 py-1.5 font-mono text-xs"
            style={{ animation: 'demo-chip 4.8s ease-in-out infinite', animationDelay: `${i * 1.2}s` }}
          >
            {chip}
          </span>
        ))}
      </div>
    </div>
  );
}

const DEMOS: Record<DemoKey, ComponentType> = {
  files: FilesDemo,
  audio: AudioDemo,
  image: ImageDemo,
  video: VideoDemo,
  captions: CaptionsDemo,
};

export function ToolDemo({ tool }: { tool: DemoKey }) {
  const Demo = DEMOS[tool];
  return (
    <div className="relative size-full" aria-hidden="true">
      <Demo />
    </div>
  );
}
