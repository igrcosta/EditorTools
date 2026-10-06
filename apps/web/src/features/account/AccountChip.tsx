import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';

/** Header slot: today's remaining runs (or "Pro") linking to the account page. Hidden when accounts are off. */
export function AccountChip() {
  const { t } = useTranslation('account');
  const { session, entitlements } = useAuth();
  if (session?.state !== 'authenticated' || !entitlements) return null;

  const { quota, plan } = entitlements;
  const label =
    quota.limit === null ? t('chip.unlimited') : t('chip.runsLeft', { left: Math.max(0, quota.limit - quota.used) });
  const low = quota.limit !== null && quota.limit - quota.used <= 2;

  return (
    <Link
      to="/account"
      title={t('chip.account')}
      className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition hover:border-white/30 ${
        plan === 'pro'
          ? 'border-accent/50 text-accent-text'
          : low
            ? 'border-amber-500/40 text-amber-300'
            : 'border-white/10 text-zinc-300'
      }`}
    >
      <i className="fi-rr-user text-xs" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sr-only sm:hidden">{label}</span>
    </Link>
  );
}
