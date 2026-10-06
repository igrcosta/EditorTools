import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from './Button';
import { PLAN_ERROR_EVENT, type PlanErrorDetail } from '../lib/api';
import { useAuth } from '../lib/auth';

/**
 * Listens for plan errors from any API call and offers the upgrade — so no tool page needs plan logic.
 * A refused session ("unauthenticated") just re-reads the session, which sends the user to sign in.
 */
export function UpgradeNotice() {
  const { t } = useTranslation('account');
  const { refresh } = useAuth();
  const [notice, setNotice] = useState<PlanErrorDetail | null>(null);

  useEffect(() => {
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<PlanErrorDetail>).detail;
      void refresh();
      if (detail.code !== 'unauthenticated') setNotice(detail);
    };
    window.addEventListener(PLAN_ERROR_EVENT, onError);
    return () => window.removeEventListener(PLAN_ERROR_EVENT, onError);
  }, [refresh]);

  if (!notice) return null;
  const quota = notice.code === 'quota_exceeded';
  const resetsAt = notice.details?.resetsAt;
  const when = resetsAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(resetsAt))
    : null;

  return (
    <div
      role="alertdialog"
      aria-labelledby="upgrade-title"
      className="panel fixed inset-x-4 bottom-4 z-50 mx-auto max-w-lg space-y-3 rounded-xl border border-accent/40 p-5 shadow-2xl"
    >
      <p id="upgrade-title" className="font-medium text-zinc-100">
        {t(quota ? 'upgrade.quotaTitle' : 'upgrade.limitTitle')}
      </p>
      <p className="text-sm text-zinc-400">
        {quota
          ? when
            ? t('upgrade.quotaDescription', { when })
            : t('upgrade.quotaDescriptionNoTime')
          : t('upgrade.limitDescription')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link
          to="/pricing"
          onClick={() => setNotice(null)}
          className="btn-primary rounded-full px-6 py-2.5 text-sm font-semibold text-white"
        >
          {t('upgrade.seePro')}
        </Link>
        <Button variant="ghost" onClick={() => setNotice(null)}>
          {t('account.cancel')}
        </Button>
      </div>
    </div>
  );
}
