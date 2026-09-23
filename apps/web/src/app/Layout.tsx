import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const NAV = [
  { to: '/download', key: 'downloader' },
  { to: '/audio', key: 'audio' },
  { to: '/convert', key: 'convert' },
  { to: '/image', key: 'image' },
  { to: '/video', key: 'video' },
  { to: '/captions', key: 'captions' },
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
            {NAV.map(({ to, key }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `rounded-full px-3 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-accent/10 text-accent-text'
                      : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`
                }
              >
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
        </div>
      </footer>
    </div>
  );
}
