import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useInView } from '../../lib/useInView';
import { IMAGE_DEMO_ASSETS, ToolDemo, type DemoKey } from './demos';

const TOOLS: ReadonlyArray<{ key: DemoKey; to: string; icon: string; title: string }> = [
  { key: 'files', to: '/files', icon: 'fi-rr-folder-download', title: 'home.files.title' },
  { key: 'audio', to: '/audio', icon: 'fi-rr-waveform', title: 'home.audio.title' },
  { key: 'image', to: '/image', icon: 'fi-rr-picture', title: 'home.image.title' },
  { key: 'video', to: '/video', icon: 'fi-rr-face-viewfinder', title: 'home.video.title' },
  { key: 'captions', to: '/captions', icon: 'fi-rr-subtitles', title: 'home.captions.title' },
];

const CYCLE_MS = 7000;

/**
 * App-window mock with one looping illustration per tool. It cycles on its own while on screen,
 * pauses on hover and when scrolled away, and never auto-advances under prefers-reduced-motion.
 * The timer is the CSS animation of the active tab's underline: when it ends, the next tool plays,
 * so pausing the animation pauses the cycle.
 */
export function Showcase() {
  const { t } = useTranslation();
  const [windowRef, inView] = useInView<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Warm the cache for the Image tab's photo, so it doesn't pop in when the tab comes up.
  useEffect(() => {
    for (const src of IMAGE_DEMO_ASSETS) new Image().src = src;
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(query.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const running = inView && !hovering;
  const current = TOOLS[active] ?? TOOLS[0]!;

  return (
    <div
      ref={windowRef}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      className={`panel overflow-hidden rounded-2xl shadow-[0_50px_140px_-50px_rgba(145,70,255,0.4)] ${
        running ? '' : 'demo-paused'
      }`}
    >
      <div className="flex h-11 items-center gap-3 border-b border-line bg-black/20 px-4">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
        </span>
        <span className="font-mono text-xs text-zinc-500">{t('appName').toLowerCase()}</span>
      </div>

      <div className="grid lg:grid-cols-[19rem_1fr]">
        <div role="tablist" className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
          {TOOLS.map(({ key, icon, title }, i) => {
            const selected = i === active;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActive(i)}
                className={`group relative cursor-pointer overflow-hidden px-5 py-4 text-left transition-colors ${
                  selected ? 'bg-white/[0.04]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <span className="flex items-center gap-3">
                  <i
                    className={`${icon} text-base transition-colors ${
                      selected ? 'text-accent-text' : 'text-zinc-500 group-hover:text-zinc-300'
                    }`}
                    aria-hidden="true"
                  />
                  <span
                    className={`text-sm font-medium transition-colors ${
                      selected ? 'text-zinc-100' : 'text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  >
                    {t(title)}
                  </span>
                </span>
                {/* Description expands under the selected tab. */}
                <span
                  className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[var(--ease-reveal)] ${
                    selected ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <span className="overflow-hidden">
                    <span className="mt-2 block pl-7 text-sm leading-relaxed text-zinc-400">
                      {t(`home.showcase.tools.${key}.body`)}
                    </span>
                  </span>
                </span>
                {selected && (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-white/10">
                    {!reducedMotion && (
                      <span
                        key={`${key}-timer`}
                        className="block h-full origin-left bg-accent-text"
                        style={{
                          animation: `tab-timer ${CYCLE_MS}ms linear forwards`,
                          animationPlayState: running ? 'running' : 'paused',
                        }}
                        onAnimationEnd={() => setActive((n) => (n + 1) % TOOLS.length)}
                      />
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-80 flex-col bg-surface-2/60 lg:aspect-video lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            <div key={current.key} className="page-enter absolute inset-0">
              <ToolDemo tool={current.key} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 border-t border-line bg-black/30 px-5 py-3.5">
            <p className="font-display text-lg leading-tight text-white sm:text-xl">
              {t(`home.showcase.tools.${current.key}.headline`)}
            </p>
            <Link
              to={current.to}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.04] px-3.5 py-1.5 text-sm text-zinc-100 transition hover:border-accent/60 hover:text-accent-text"
            >
              {t('home.showcase.open')}
              <i className="fi-rr-arrow-small-right text-base" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
