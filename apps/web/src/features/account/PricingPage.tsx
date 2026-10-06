import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { DEFAULT_PLAN_LIMITS } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorMessage } from '../../components/ErrorMessage';
import { PageHeader } from '../../components/PageHeader';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/**
 * Set at build time (VITE_CHECKOUT_URL) once the Kiwify product exists. Until then the button is
 * honestly labelled "coming soon" instead of pretending to sell something.
 */
const CHECKOUT_URL = (import.meta.env.VITE_CHECKOUT_URL as string | undefined) ?? '';

const POLL_MS = 10_000;
const POLL_FOR_MS = 10 * 60_000;

function checkoutUrlFor(base: string, email: string, userId: string): string | null {
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:') return null;
    url.searchParams.set('email', email); // prefilled; the account is matched by the verified email
    url.searchParams.set('sck', userId); // a hint only, never an authority
    return url.toString();
  } catch {
    return null;
  }
}

export function PricingPage() {
  const { t } = useTranslation('account');
  const { session, entitlements, refresh } = useAuth();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const pollingUntil = useRef(0);
  const plan = entitlements?.plan;

  // After the browser opens, look for the payment every 10 s for 10 min (Pix/boleto are not instant).
  useEffect(() => {
    if (!opened || plan === 'pro') return;
    pollingUntil.current = Date.now() + POLL_FOR_MS;
    const timer = setInterval(() => {
      if (Date.now() > pollingUntil.current) return clearInterval(timer);
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [opened, plan, refresh]);

  const subscribe = useCallback(async () => {
    if (session?.state !== 'authenticated') return;
    const url = checkoutUrlFor(CHECKOUT_URL, session.user.email, session.user.id);
    if (!url) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.openExternal(url);
      setOpened(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [session]);

  const alreadyPaid = async () => {
    setBusy(true);
    setNotYet(false);
    await refresh();
    setBusy(false);
    setNotYet(true);
  };

  if (session?.state !== 'authenticated' || !entitlements) return <Navigate to="/login" replace />;
  const free = DEFAULT_PLAN_LIMITS.free;
  const isPro = entitlements.plan === 'pro';
  const canBuy = checkoutUrlFor(CHECKOUT_URL, session.user.email, session.user.id) !== null;

  return (
    <div className="space-y-6">
      <PageHeader title={t('pricing.title')} description={t('pricing.description')} />

      {isPro && opened && <p className="text-sm text-emerald-300">{t('pricing.activated')}</p>}
      {failed && <ErrorMessage>{t('errors.generic')}</ErrorMessage>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-2">
          <p className="font-display text-lg text-zinc-100">{t('pricing.freeTitle')}</p>
          <p className="text-sm text-zinc-400">
            {t('pricing.freeItems', { runs: free.dailyRuns, minutes: Math.round((free.maxMediaSeconds ?? 0) / 60) })}
          </p>
          {!isPro && <p className="text-xs text-accent-text">{t('pricing.currentPlan')}</p>}
        </Card>

        <Card className="space-y-3 border border-accent/40">
          <p className="font-display text-lg text-zinc-100">{t('pricing.proTitle')}</p>
          <p className="text-sm text-zinc-400">{t('pricing.proItems')}</p>
          {isPro ? (
            <p className="text-xs text-accent-text">{t('pricing.currentPlan')}</p>
          ) : (
            <>
              <Button className="w-full" disabled={!canBuy || busy} onClick={() => void subscribe()}>
                {!canBuy ? t('pricing.comingSoon') : busy && !opened ? t('pricing.opening') : t('pricing.subscribe')}
              </Button>
              {canBuy && <p className="text-xs text-zinc-500">{t('pricing.sameEmail', { email: session.user.email })}</p>}
            </>
          )}
        </Card>
      </div>

      {opened && !isPro && (
        <Card className="space-y-3">
          <p className="text-sm text-zinc-300">{t('pricing.checkoutOpened')}</p>
          <Button variant="secondary" disabled={busy} onClick={() => void alreadyPaid()}>
            {busy ? t('pricing.checking') : t('pricing.alreadyPaid')}
          </Button>
          {notYet && <p className="text-sm text-zinc-400">{t('pricing.notYet', { email: session.user.email })}</p>}
        </Card>
      )}
    </div>
  );
}
