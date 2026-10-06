import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UpgradeNotice } from '../components/UpgradeNotice';
import { AccountChip } from '../features/account/AccountChip';

const NAV = [
  { to: '/files', key: 'files', icon: 'fi-rr-folder-download' },
  { to: '/audio', key: 'audio', icon: 'fi-rr-waveform' },
  { to: '/image', key: 'image', icon: 'fi-rr-picture' },
  { to: '/video', key: 'video', icon: 'fi-rr-face-viewfinder' },
  { to: '/captions', key: 'captions', icon: 'fi-rr-subtitles' },
] as const;

// Face Tracking and Captions need real side-by-side room (video preview + a side/right panel) —
// every other tool page is a narrow single-column form and stays at max-w-3xl.
const WIDE_ROUTES = ['/video', '/captions'];

interface Pill {
  x: number;
  w: number;
}

export function Layout() {
  const { t } = useTranslation();
  const pathname = useLocation().pathname;
  const isHome = pathname === '/';
  const isWide = WIDE_ROUTES.includes(pathname);

  const navRef = useRef<HTMLElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pill, setPill] = useState<Pill | null>(null);
  const [pillVisible, setPillVisible] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [layoutTick, setLayoutTick] = useState(0);

  // The sliding highlight follows the hovered link, and settles back on the active one.
  const activeTo = NAV.find((item) => item.to === pathname)?.to ?? null;
  const target = hovered ?? activeTo;

  useLayoutEffect(() => {
    const el = target ? navRef.current?.querySelector<HTMLElement>(`[data-to="${target}"]`) : null;
    if (!el) {
      setPillVisible(false);
      return;
    }
    setPill({ x: el.offsetLeft, w: el.offsetWidth });
    setPillVisible(true);
  }, [target, layoutTick]);

  useEffect(() => {
    // Link widths shift when the web/icon fonts finish loading, so re-measure whenever the nav resizes.
    const remeasure = () => setLayoutTick((n) => n + 1);
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    const observer = new ResizeObserver(remeasure);
    if (navRef.current) observer.observe(navRef.current);
    void document.fonts?.ready.then(remeasure);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);

  // One delegated listener feeds the cursor spotlight of every `.spotlight` element.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.spotlight');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
      el.style.setProperty('--my', `${e.clientY - rect.top}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center px-4 pt-4">
        <div
          className={`pointer-events-auto flex h-12 items-center gap-2 rounded-full border bg-zinc-950/90 py-1 pr-1.5 pl-4 backdrop-blur-xl transition-[border-color,box-shadow] duration-300 ${
            scrolled
              ? 'border-white/15 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.9)]'
              : 'border-white/10 shadow-[0_8px_30px_-16px_rgba(0,0,0,0.8)]'
          }`}
        >
          <Link
            to="/"
            className="flex items-center gap-2 pr-3 font-display text-sm tracking-[0.06em] text-zinc-100"
          >
            <img src="/logo-mark.png" alt="" className="h-5 w-auto" width={32} height={24} />
            <span className="hidden sm:inline">{t('appName')}</span>
          </Link>
          <span className="hidden h-5 w-px bg-white/10 sm:block" aria-hidden="true" />
          <nav
            ref={navRef}
            className="relative flex items-center"
            onMouseLeave={() => setHovered(null)}
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 rounded-full bg-white/[0.07] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] transition-[transform,width,opacity] duration-300 ease-[var(--ease-reveal)]"
              style={{
                width: pill?.w ?? 0,
                transform: `translateX(${pill?.x ?? 0}px)`,
                opacity: pillVisible ? 1 : 0,
              }}
            />
            {NAV.map(({ to, key, icon }) => (
              <NavLink
                key={to}
                to={to}
                data-to={to}
                onMouseEnter={() => setHovered(to)}
                onFocus={() => setHovered(to)}
                onBlur={() => setHovered(null)}
                className={({ isActive }) =>
                  `relative z-10 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors ${
                    isActive ? 'text-accent-text' : 'text-zinc-400 hover:text-zinc-100'
                  }`
                }
              >
                <i className={`${icon} text-sm`} aria-hidden="true" />
                <span className="hidden md:inline">{t(`nav.${key}`)}</span>
                <span className="sr-only md:hidden">{t(`nav.${key}`)}</span>
              </NavLink>
            ))}
          </nav>
          <AccountChip />
        </div>
      </header>
      <UpgradeNotice />

      <main
        className={
          isHome
            ? 'flex flex-1 flex-col'
            : `mx-auto w-full flex-1 px-4 pt-28 pb-16 ${isWide ? 'max-w-5xl' : 'max-w-3xl'}`
        }
      >
        <div key={pathname} className="page-enter flex flex-1 flex-col">
          <Outlet />
        </div>
      </main>

      <footer className="relative z-20 border-t border-white/[0.06]">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-4 py-6 text-xs text-zinc-500">
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
