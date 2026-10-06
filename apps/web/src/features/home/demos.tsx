import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';

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
 * (sampled to 10 per second). All three come from one real run of the app (see public/demo); the
 * posters are their first frames, so a preview is never an empty box while it loads or if it can't play.
 */
const TRACK_DEMO = {
  original: { src: '/demo/vlog-original.mp4', poster: '/demo/vlog-original-poster.jpg' },
  result: { src: '/demo/vlog-tracked.mp4', poster: '/demo/vlog-tracked-poster.jpg' },
  track: '/demo/vlog-track.json',
} as const;

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

/** Whether the demos should be moving right now (on screen, window visible, not paused by the user). */
export const DemoPlayback = createContext(true);

/**
 * Keeps a muted, looping preview video playing whenever `playing` is true, and paused otherwise.
 *
 * A bare `video.play()` call is not reliable enough for something that must simply always run:
 * - React doesn't reliably emit the `muted` attribute, and an unmuted video is refused autoplay, so
 *   muted is set on the element itself;
 * - play() is refused or ignored if the data isn't there yet, so it is retried when the video says
 *   it can play, and a watchdog retries while it is meant to be playing but sits paused;
 * - a hidden window should not keep decoding.
 */
function useLoopingVideo(ref: RefObject<HTMLVideoElement | null>, playing: boolean): void {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
  }, [ref]);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (!playing) {
      video.pause();
      return;
    }

    const attempt = () => {
      if (document.hidden || !video.paused) return;
      video.play().catch(() => undefined); // not ready or refused: the listeners below try again
    };
    attempt();
    video.addEventListener('loadeddata', attempt);
    video.addEventListener('canplay', attempt);
    const watchdog = window.setInterval(attempt, 1500);
    const onVisibility = () => (document.hidden ? video.pause() : attempt());
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      video.removeEventListener('loadeddata', attempt);
      video.removeEventListener('canplay', attempt);
      window.clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ref, playing]);
}

/** Only drifts this far (seconds) before the result video is pulled back into step with the original. */
const MAX_DRIFT_SECONDS = 0.25;

function VideoDemo() {
  const { t } = useTranslation();
  const playing = useContext(DemoPlayback);
  const originalRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [track, setTrack] = useState<CropTrack | null>(null);

  useLoopingVideo(originalRef, playing);
  useLoopingVideo(resultRef, playing);

  useEffect(() => {
    let alive = true;
    fetch(TRACK_DEMO.track)
      .then((res) => (res.ok ? (res.json() as Promise<CropTrack>) : null))
      .then((data) => {
        if (alive && data) setTrack(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // The crop box is placed from the real crop track, read against the original's own clock, so it
  // can never disagree with the video beside it. It moves by transform (compositor-only, no layout
  // per frame), driven by the video's own frame callback where the browser has one, and it is kept
  // up to date while paused too, so the box always matches the frame being shown.
  useEffect(() => {
    const original = originalRef.current;
    const result = resultRef.current;
    const frame = frameRef.current;
    const box = boxRef.current;
    if (!original || !result || !frame || !box || !track) return;

    let size = { w: frame.clientWidth, h: frame.clientHeight };
    const place = (time = original.currentTime) => {
      const { x, y } = cropAt(track, time);
      box.style.transform = `translate(${(x / track.source.width) * size.w}px, ${(y / track.source.height) * size.h}px)`;
    };
    const fit = () => {
      size = { w: frame.clientWidth, h: frame.clientHeight };
      box.style.width = `${(track.crop.width / track.source.width) * size.w}px`;
      box.style.height = `${(track.crop.height / track.source.height) * size.h}px`;
      // The dimming around the box is its own shadow; it only needs to reach the frame's edges.
      box.style.boxShadow = `0 0 0 ${Math.max(size.w, size.h)}px rgba(0, 0, 0, 0.5)`;
      place();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(frame);

    const resync = () => {
      if (Math.abs(result.currentTime - original.currentTime) > MAX_DRIFT_SECONDS) {
        result.currentTime = original.currentTime;
      }
    };
    const onSeeked = () => place();
    original.addEventListener('seeked', onSeeked);

    let handle = 0;
    const hasFrameCallback = typeof original.requestVideoFrameCallback === 'function';
    const loop = (_now?: number, metadata?: VideoFrameCallbackMetadata) => {
      place(metadata?.mediaTime);
      resync();
      handle = hasFrameCallback ? original.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);
    };
    if (playing) handle = hasFrameCallback ? original.requestVideoFrameCallback(loop) : requestAnimationFrame(loop);

    return () => {
      observer.disconnect();
      original.removeEventListener('seeked', onSeeked);
      if (hasFrameCallback) original.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
    };
  }, [track, playing]);

  return (
    // Size container: both videos share one height, chosen so that the 16:9 original and the 9:16
    // result sit side by side inside whatever stage this is given.
    <div className="absolute inset-0 grid place-items-center overflow-hidden" style={{ containerType: 'size' }}>
      <div
        className="flex items-center gap-3"
        style={{ height: 'min(calc(100cqh - 24px), calc((100cqw - 36px) / 2.34))' }}
      >
        <div ref={frameRef} className="relative h-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '16 / 9' }}>
          <video
            ref={originalRef}
            src={TRACK_DEMO.original.src}
            poster={TRACK_DEMO.original.poster}
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            tabIndex={-1}
            className="absolute inset-0 size-full object-cover"
          />
          {track && <div ref={boxRef} className="absolute top-0 left-0 rounded-sm border-2 border-accent-text will-change-transform" />}
          <span className="absolute top-2 left-2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-zinc-100 backdrop-blur">
            {t('home.showcase.track.before')}
          </span>
        </div>
        <div className="relative h-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: '9 / 16' }}>
          <video
            ref={resultRef}
            src={TRACK_DEMO.result.src}
            poster={TRACK_DEMO.result.poster}
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            disableRemotePlayback
            tabIndex={-1}
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
