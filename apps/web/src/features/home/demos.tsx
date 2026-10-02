import { useEffect, useRef, useState, type ComponentType, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useInView } from '../../lib/useInView';

/**
 * Looping illustrations of what each tool does, for the landing page. They are decorative
 * (aria-hidden) and never show numbers or progress: nothing here pretends to be a real job. The
 * image and face-tracking ones use real media, each the output of one real run of that tool; the
 * rest are CSS-only. Each one fills its (relatively positioned) container.
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

/* ───────── Face Tracking: a real clip, the app's own 9:16 result, and the crop that made it ───────── */

/**
 * The clip, the vertical video Face Tracking made from it, and that run's per-frame crop position
 * (sampled to 10 per second). All three come from one real run of the app (see public/demo).
 */
const TRACK_DEMO_VIDEOS = ['/demo/vlog-original.mp4', '/demo/vlog-tracked.mp4'] as const;
const TRACK_DEMO_JSON = '/demo/vlog-track.json';

interface CropTrack {
  source: { width: number; height: number };
  crop: { width: number; height: number };
  fps: number;
  x: number[];
  y: number[];
}

/** Crop position (source pixels) at time `t`, interpolated between the stored samples. */
function cropAt(track: CropTrack, t: number): { x: number; y: number } {
  const last = track.x.length - 1;
  const f = Math.min(last, Math.max(0, t * track.fps));
  const i = Math.floor(f);
  const j = Math.min(last, i + 1);
  const k = f - i;
  return { x: track.x[i] + (track.x[j] - track.x[i]) * k, y: track.y[i] + (track.y[j] - track.y[i]) * k };
}

/** Only drifts this far (seconds) before the result video is pulled back into step with the original. */
const MAX_DRIFT_SECONDS = 0.25;

function VideoDemo() {
  const { t } = useTranslation();
  const [stageRef, onScreen] = useInView<HTMLDivElement>();
  const originalRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [track, setTrack] = useState<CropTrack | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(TRACK_DEMO_JSON)
      .then((res) => (res.ok ? (res.json() as Promise<CropTrack>) : null))
      .then((data) => {
        if (alive && data) setTrack(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Plays while on screen (and the window is visible); the box is driven by the real crop track,
  // read against the original's own clock, so it can never disagree with the video beside it.
  useEffect(() => {
    const original = originalRef.current;
    const result = resultRef.current;
    const box = boxRef.current;
    if (!original || !result || !box || !track) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const place = () => {
      const { x, y } = cropAt(track, original.currentTime);
      box.style.left = `${(x / track.source.width) * 100}%`;
      box.style.top = `${(y / track.source.height) * 100}%`;
    };
    place();
    if (reduced || !onScreen) {
      original.pause();
      result.pause();
      return;
    }

    let frame = 0;
    const tick = () => {
      place();
      if (Math.abs(result.currentTime - original.currentTime) > MAX_DRIFT_SECONDS) {
        result.currentTime = original.currentTime;
      }
      frame = requestAnimationFrame(tick);
    };
    void original.play().catch(() => undefined);
    void result.play().catch(() => undefined);
    frame = requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.hidden) {
        original.pause();
        result.pause();
      } else {
        void original.play().catch(() => undefined);
        void result.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [track, onScreen]);

  const crop = track ? { w: track.crop.width / track.source.width, h: track.crop.height / track.source.height } : null;

  return (
    // Size container: both videos share one height, chosen so that the 16:9 original and the 9:16
    // result sit side by side inside whatever stage this is given.
    <div
      ref={stageRef}
      className="absolute inset-0 grid place-items-center overflow-hidden"
      style={{ containerType: 'size' }}
    >
      <div
        className="flex items-center gap-3"
        style={{ height: 'min(calc(100cqh - 24px), calc((100cqw - 36px) / 2.34))' }}
      >
        <div className="relative h-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '16 / 9' }}>
          <video
            ref={originalRef}
            src={`${TRACK_DEMO_VIDEOS[0]}#t=0.1`}
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 size-full object-cover"
          />
          {crop && (
            <div
              ref={boxRef}
              className="absolute rounded-sm border-2 border-accent-text shadow-[0_0_0_999px_rgba(0,0,0,0.5)]"
              style={{ width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
            />
          )}
          <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur">
            {t('home.showcase.track.before')}
          </span>
        </div>
        <div className="relative h-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '9 / 16' }}>
          <video
            ref={resultRef}
            src={`${TRACK_DEMO_VIDEOS[1]}#t=0.1`}
            muted
            loop
            playsInline
            preload="auto"
            className="absolute inset-0 size-full object-cover"
          />
          <span className="absolute top-2 left-2 rounded-full bg-accent/90 px-2.5 py-1 text-[11px] font-semibold text-white">
            {t('home.showcase.track.after')}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ───────── Image: a real photo, and the app's own cut-out of it, swept by a divider ───────── */

/** The photo and the transparent PNG that Remove Background produced for it (see public/demo). */
export const IMAGE_DEMO_ASSETS = ['/demo/car-original.jpg', '/demo/car-cutout.webp'] as const;
const IMAGE_DEMO_RATIO = '3 / 2';

function ImageDemo() {
  const { t } = useTranslation();
  return (
    // A size container, so the photo can be sized as "the largest 3:2 box that fits" in plain CSS
    // (cqw/cqh) and the divider and checkerboard then span the photo itself, not letterbox bands.
    <div className="absolute inset-0 grid place-items-center overflow-hidden" style={{ containerType: 'size' }}>
      <div
        className="relative overflow-hidden rounded-lg shadow-[0_20px_60px_-20px_rgba(0,0,0,0.9)]"
        style={{ width: 'min(100cqw, 150cqh)', aspectRatio: IMAGE_DEMO_RATIO }}
      >
        <img
          src={IMAGE_DEMO_ASSETS[0]}
          alt=""
          draggable={false}
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
        {/* The cut-out, over a checkerboard so the removed background reads as transparent. */}
        <div className="checkerboard absolute inset-0" style={{ animation: 'demo-compare 6s ease-in-out infinite' }}>
          <img
            src={IMAGE_DEMO_ASSETS[1]}
            alt=""
            draggable={false}
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        </div>
        <span
          className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_16px_rgba(255,255,255,0.7)]"
          style={{ animation: 'demo-compare-bar 6s ease-in-out infinite' }}
        />
        <span className="absolute top-2.5 left-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur">
          {t('home.showcase.compare.before')}
        </span>
        <span className="absolute top-2.5 right-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur">
          {t('home.showcase.compare.after')}
        </span>
      </div>
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
