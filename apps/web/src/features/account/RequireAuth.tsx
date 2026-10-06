import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useAuth } from '../../lib/auth';
import { ConsentNotice } from './ConsentNotice';

/**
 * Gate for the whole app. With accounts off on this server (web demo, dev without Supabase) it lets
 * everything through, exactly as before accounts existed.
 */
export function RequireAuth() {
  const { t } = useTranslation('account');
  const { session, refresh, entitlements } = useAuth();
  const location = useLocation();

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-sm text-zinc-400">
        <Spinner /> {t('loading')}
      </div>
    );
  }
  if (session.state === 'disabled') return <Outlet />;
  if (session.state === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (session.state === 'unreachable') {
    return (
      <Card className="mx-auto w-full max-w-md space-y-3 text-center">
        <p className="font-medium text-zinc-100">{t('unreachable.title')}</p>
        <p className="text-sm text-zinc-400">{t('unreachable.description')}</p>
        <Button onClick={() => void refresh()}>{t('unreachable.retry')}</Button>
      </Card>
    );
  }
  return (
    <>
      {entitlements && !entitlements.consentAnswered && <ConsentNotice />}
      <Outlet />
    </>
  );
}
