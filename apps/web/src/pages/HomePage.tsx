import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CONVERT_FORMATS } from '@editools/shared';
import { DotField } from '../components/DotField';
import { Reveal } from '../components/Reveal';
import { Showcase } from '../features/home/Showcase';

const TOOLS = [
  { to: '/files', key: 'files', icon: 'fi-rr-folder-download', span: 'lg:col-span-2' },
  { to: '/audio', key: 'audio', icon: 'fi-rr-waveform', span: 'lg:col-span-2' },
  { to: '/image', key: 'image', icon: 'fi-rr-picture', span: 'lg:col-span-2' },
  { to: '/video', key: 'video', icon: 'fi-rr-face-viewfinder', span: 'lg:col-span-3' },
  { to: '/captions', key: 'captions', icon: 'fi-rr-subtitles', span: 'lg:col-span-3' },
] as const;

const FORMATS = [...CONVERT_FORMATS, 'png', 'jpg', 'webp'].map((f) => f.toUpperCase());

const PRIVACY = [
  { key: 'local', icon: 'fi-rr-laptop' },
  { key: 'accounts', icon: 'fi-rr-user-slash' },
  { key: 'tracking', icon: 'fi-rr-shield-check' },
] as const;

function Eyebrow({ children }: { children: string }) {
  return <p className="text-xs font-medium tracking-[0.2em] text-accent-text uppercase">{children}</p>;
}

function SectionTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-fade mt-3 font-display text-4xl leading-[1.02] sm:text-6xl">{title}</h2>
      {subtitle && <p className="mt-4 text-base text-zinc-400">{subtitle}</p>}
    </Reveal>
  );
}

/** Headline that rises in word by word on first paint. */
function HeroTitle({ text }: { text: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <h1 className="mt-7 font-display text-6xl leading-[0.95] sm:text-8xl">
      {text.split(' ').map((word, i) => (
        <span
          key={`${word}-${i}`}
          className="reveal text-fade mr-[0.22em] inline-block last:mr-0"
          data-in={shown}
          style={{ '--reveal-delay': `${120 + i * 110}ms`, '--reveal-distance': '28px', '--reveal-blur': '10px' } as CSSProperties}
        >
          {word}
        </span>
      ))}
    </h1>
  );
}

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col">
      {/* ───── Hero ───── */}
      <section className="relative flex min-h-[min(86svh,860px)] items-center justify-center overflow-hidden bg-black">
        <DotField className="absolute inset-0" speed={1.4} />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.8)_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-zinc-950" />

        <div className="relative z-10 flex flex-col items-center px-4 pt-28 pb-24 text-center">
          <img
            src="/logo-mark.png"
            alt="Editools"
            width={116}
            height={88}
            className="h-[72px] w-auto"
            style={{ filter: 'drop-shadow(0 0 28px rgba(132,77,234,0.55))' }}
          />
          <Reveal delay={60} className="mt-7">
            <span className="inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] py-1.5 pr-4 pl-3 text-xs text-zinc-300 backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="pulse-ring absolute inset-0 rounded-full bg-accent-text" />
                <span className="relative h-2 w-2 rounded-full bg-accent-text" />
              </span>
              {t('home.hero.badge')}
            </span>
          </Reveal>
          <HeroTitle text={t('tagline')} />
          <Reveal delay={520} className="mt-6">
            <p className="text-lg text-zinc-400">{t('subtitle')}</p>
          </Reveal>
          <Reveal delay={640} className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#tools"
              className="btn-primary inline-flex items-center gap-2 rounded-full px-7 py-3 text-sm font-semibold text-white"
            >
              {t('home.hero.primary')}
              <i className="fi-rr-arrow-small-right text-base" aria-hidden="true" />
            </a>
            <a
              href="#showcase"
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-7 py-3 text-sm text-zinc-200 backdrop-blur transition hover:border-accent/50 hover:bg-accent/[0.08]"
            >
              {t('home.hero.secondary')}
            </a>
          </Reveal>
        </div>
      </section>

      {/* ───── Launchpad: where the work starts ───── */}
      <section id="tools" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 pt-8 pb-28">
        <SectionTitle eyebrow={t('home.launchpad.eyebrow')} title={t('home.launchpad.title')} />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {TOOLS.map(({ to, key, icon, span }, i) => {
            const tags = t(`home.${key}.tags`, { returnObjects: true }) as string[];
            return (
              <Reveal key={to} delay={i * 70} className={span}>
                <Link
                  to={to}
                  className="spotlight panel group relative flex h-full min-h-48 flex-col rounded-2xl p-6 transition-transform duration-300 ease-[var(--ease-reveal)] hover:-translate-y-1"
                >
                  <div className="flex items-start justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl border border-accent/30 bg-accent/10 text-xl text-accent-text shadow-[0_0_28px_-8px_rgba(145,70,255,0.9)]">
                      <i className={icon} aria-hidden="true" />
                    </span>
                    <i
                      className="fi-rr-arrow-right text-lg text-zinc-600 transition duration-300 group-hover:translate-x-1 group-hover:text-accent-text"
                      aria-hidden="true"
                    />
                  </div>
                  <p className="mt-8 text-xl font-semibold tracking-tight text-zinc-100">
                    {t(`home.${key}.title`)}
                  </p>
                  <p className="mt-1.5 text-sm text-zinc-400">{t(`home.${key}.description`)}</p>
                  <ul className="mt-auto flex flex-wrap gap-1.5 pt-5">
                    {tags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 text-xs text-zinc-400"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ───── Showcase: looping product demos ───── */}
      <section id="showcase" className="mx-auto w-full max-w-5xl scroll-mt-24 px-4 pb-28">
        <SectionTitle
          eyebrow={t('home.showcase.eyebrow')}
          title={t('home.showcase.title')}
          subtitle={t('home.showcase.subtitle')}
        />
        <Reveal className="mt-14" distance={32} blur={10}>
          <Showcase />
        </Reveal>
      </section>

      {/* ───── Formats marquee ───── */}
      <section className="pb-28">
        <Reveal>
          <p className="mb-6 text-center text-sm text-zinc-500">{t('home.formats.label')}</p>
          <div className="marquee flex overflow-hidden" aria-hidden="true">
            {[0, 1].map((copy) => (
              <ul key={copy} className="marquee-track flex min-w-full shrink-0 items-center justify-around gap-3 pr-3">
                {FORMATS.map((format) => (
                  <li
                    key={format}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 font-mono text-sm text-zinc-400"
                  >
                    {format}
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </Reveal>
      </section>

      {/* ───── Privacy ───── */}
      <section className="mx-auto w-full max-w-5xl px-4 pb-32">
        <SectionTitle eyebrow={t('home.privacy.eyebrow')} title={t('home.privacy.title')} />
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {PRIVACY.map(({ key, icon }, i) => (
            <Reveal key={key} delay={i * 80}>
              <div className="panel h-full rounded-2xl p-6">
                <i className={`${icon} text-2xl text-accent-text`} aria-hidden="true" />
                <p className="mt-6 text-lg font-semibold text-zinc-100">{t(`home.privacy.${key}.title`)}</p>
                <p className="mt-1.5 text-sm text-zinc-400">{t(`home.privacy.${key}.body`)}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}
