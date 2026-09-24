import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const NAV = [
  { to: '/files', key: 'files', icon: 'fi-rr-folder-download' },
  { to: '/audio', key: 'audio', icon: 'fi-rr-waveform' },
  { to: '/image', key: 'image', icon: 'fi-rr-picture' },
  { to: '/video', key: 'video', icon: 'fi-rr-face-viewfinder' },
  { to: '/captions', key: 'captions', icon: 'fi-rr-subtitles' },
] as const;

export function Layout() {
  const { t } = useTranslation();
  const isHome = useLocation().pathname === '/';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="z-20 border-b border-white/10 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center gap-8 px-4">
          <Link to="/" className="flex items-center gap-2 font-display text-sm tracking-[0.06em] text-zinc-100">
            <img src="/logo-mark.png" alt="" className="h-6 w-auto" width={32} height={24} />
            {t('appName')}
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            {NAV.map(({ to, key, icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-accent/10 text-accent-text'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`
                }
              >
                <i className={`${icon} text-sm`} aria-hidden="true" />
                {t(`nav.${key}`)}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className={isHome ? 'flex flex-1 flex-col' : 'mx-auto w-full max-w-3xl flex-1 px-4 py-10'}>
        <Outlet />
      </main>
      <footer className="z-20 border-t border-white/10">
        <div className="mx-auto w-full max-w-4xl space-y-1 px-4 py-4 text-xs text-zinc-500">
          <p>{t('footer.privacy')}</p>
          <p>{t('footer.legal')}</p>
          <p>
            {t('footer.icons')}{' '}
            <a
              href="https://www.flaticon.com/uicons"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-zinc-300"
            >
              Flaticon UIcons
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
