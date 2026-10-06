import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Reveal } from '../../web/src/components/Reveal';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium tracking-[0.2em] text-accent-text uppercase">{children}</p>;
}

export function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-fade mt-3 font-display text-4xl leading-[1.02] sm:text-6xl">{title}</h2>
      {subtitle && <p className="mt-4 text-base text-zinc-400">{subtitle}</p>}
    </Reveal>
  );
}

/**
 * A muted, looping preview that must simply keep playing. A bare play() is not reliable enough:
 * React does not always emit the `muted` attribute (an unmuted video is refused autoplay), play()
 * is ignored before data arrives, and a hidden tab should not keep decoding.
 */
export function LoopVideo({ src, poster, label, className = '' }: { src: string; poster: string; label: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;

    const attempt = () => {
      if (document.hidden || !video.paused) return;
      video.play().catch(() => undefined);
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
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      muted
      loop
      autoPlay
      playsInline
      preload="auto"
      aria-label={label}
      className={`block h-full w-full object-cover ${className}`}
    />
  );
}

/** Before/after slider driven by an accessible range input. */
export function BeforeAfterSlider({
  before,
  after,
  beforeLabel,
  afterLabel,
  alt,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
  alt: string;
}) {
  const [split, setSplit] = useState(50);
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black select-none">
      <img src={before} alt={alt} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      <div className="checkerboard absolute inset-0" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
        <img src={after} alt="" className="h-full w-full object-cover" draggable={false} />
      </div>
      <span className="absolute top-3 left-3 rounded-md border border-white/15 bg-zinc-950/70 px-2 py-1 text-xs font-medium text-zinc-200">
        {beforeLabel}
      </span>
      <span className="absolute top-3 right-3 rounded-md border border-white/15 bg-zinc-950/70 px-2 py-1 text-xs font-medium text-zinc-200">
        {afterLabel}
      </span>
      <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]" style={{ left: `${split}%` }} />
      <div
        className="pointer-events-none absolute top-1/2 grid h-9 w-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-zinc-950 shadow-lg"
        style={{ left: `${split}%` }}
        aria-hidden="true"
      >
        <i className="fi-rr-arrow-right text-sm" />
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={split}
        onChange={(e) => setSplit(Number(e.target.value))}
        aria-label={`${beforeLabel} / ${afterLabel}`}
        className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />
    </div>
  );
}

export function Button({
  href,
  disabled,
  variant = 'primary',
  children,
  className = '',
}: {
  href?: string;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  children: ReactNode;
  className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-full px-7 py-3 text-sm transition';
  const look =
    variant === 'primary'
      ? 'btn-primary font-semibold text-white'
      : 'border border-white/10 bg-white/[0.04] text-zinc-200 backdrop-blur hover:border-accent/50 hover:bg-accent/[0.08]';
  if (disabled || !href) {
    return (
      <span aria-disabled="true" className={`${base} ${look} cursor-not-allowed opacity-50 ${className}`}>
        {children}
      </span>
    );
  }
  return (
    <a href={href} className={`${base} ${look} ${className}`}>
      {children}
    </a>
  );
}
