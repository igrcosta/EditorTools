import { Link, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-4">
          <Link to="/" className="text-sm font-bold tracking-[0.2em] text-zinc-100">
            {t('appName')}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <Outlet />
      </main>
      <footer className="border-t border-zinc-800">
        <div className="mx-auto w-full max-w-3xl space-y-1 px-4 py-4 text-xs text-zinc-500">
          <p>{t('footer.privacy')}</p>
          <p>{t('footer.legal')}</p>
        </div>
      </footer>
    </div>
  );
}
