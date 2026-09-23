import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DotField } from '../components/DotField';

const CTAS = [
  { to: '/download', key: 'downloader' },
  { to: '/audio', key: 'audio' },
  { to: '/convert', key: 'convert' },
  { to: '/image', key: 'image' },
  { to: '/video', key: 'video' },
  { to: '/captions', key: 'captions' },
] as const;

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-black">
      <DotField className="absolute inset-0" speed={1.4} />
      {/* Vignette so the field never competes with the copy. */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.75)_100%)]" />

      <div className="relative z-10 flex flex-col items-center px-4 py-20 text-center">
        <img
          src="/logo-mark.png"
          alt="Editools"
          width={116}
          height={88}
          className="h-[88px] w-auto"
          style={{ filter: 'drop-shadow(0 0 28px rgba(132,77,234,0.55))' }}
        />
        <h1 className="mt-6 font-display text-5xl leading-[0.95] text-white sm:text-7xl">
          {t('tagline')}
        </h1>
        <p className="mt-5 text-base text-zinc-400">{t('subtitle')}</p>

        <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {CTAS.map(({ to, key }) => (
            <Link
              key={to}
              to={to}
              className="group rounded-lg border border-white/10 bg-surface p-4 text-left transition-colors duration-200 hover:border-accent/50"
            >
              <p className="font-medium text-zinc-100 group-hover:text-accent-text">
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
