import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DotField } from '../components/DotField';

const CTAS = [
  { to: '/download', key: 'downloader' },
  { to: '/audio', key: 'audio' },
  { to: '/convert', key: 'convert' },
  { to: '/image', key: 'image' },
  { to: '/video', key: 'video' },
] as const;

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
      <DotField className="absolute inset-0" speed={1.4} />
      {/* Vignette so the field never competes with the copy. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]" />

      <div className="relative z-10 flex flex-col items-center px-4 py-16 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.4em] text-accent/80">
          {t('appName')}
        </p>
        <h1 className="mt-5 bg-gradient-to-b from-white via-zinc-100 to-accent bg-clip-text text-4xl font-semibold text-transparent sm:text-6xl">
          {t('tagline')}
        </h1>
        <p className="mt-4 text-base text-zinc-400">{t('subtitle')}</p>

        <div className="mt-12 grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CTAS.map(({ to, key }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-lg border border-zinc-700/60 bg-zinc-950/70 p-4 text-left backdrop-blur transition-colors hover:border-accent"
            >
              <p className="font-medium text-zinc-100 group-hover:text-accent">
                {t(`home.${key}.title`)}
              </p>
              <p className="mt-1 text-sm text-zinc-500">{t(`home.${key}.description`)}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
