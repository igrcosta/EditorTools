import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Entitlements, PlanId, SessionInfo } from '@editools/shared';
import { api, JOB_STARTED_EVENT } from './api';

/** What the signed-out UI must forget: the browser the user picked for cookies is account-specific. */
const USER_KEYS = ['editools.downloader.cookiesFromBrowser'];

function forgetUserData(): void {
  try {
    for (const key of USER_KEYS) localStorage.removeItem(key);
  } catch {
    // storage unavailable: nothing to forget
  }
}

interface AuthValue {
  /** null while the first answer is on its way. */
  session: SessionInfo | null;
  /** The entitlements when signed in, else null. */
  entitlements: Entitlements | null;
  isAdmin: boolean;
  refresh: () => Promise<void>;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  setConsent: (value: boolean) => Promise<void>;
  deleteAccount: () => Promise<void>;
  adminSetPlan: (plan: PlanId) => Promise<void>;
  adminResetQuota: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const alive = useRef(true);

  const apply = useCallback((info: SessionInfo) => {
    if (alive.current) setSession(info);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await api.getEntitlements());
    } catch {
      // The local server answers /api/session even when accounts are off; keep the last known state
      // if this poll failed, and only fall back to it on the very first load.
      try {
        apply(await api.getSession());
      } catch {
        if (alive.current) setSession((current) => current ?? { state: 'disabled' });
      }
    }
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    void api
      .getSession()
      .then(apply)
      .catch(() => apply({ state: 'disabled' }));
    // The plan can change while the app is in the background (a payment, an admin override).
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(JOB_STARTED_EVENT, onFocus); // a started job used a run of today's quota
    return () => {
      alive.current = false;
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(JOB_STARTED_EVENT, onFocus);
    };
  }, [apply, refresh]);

  const value = useMemo<AuthValue>(() => {
    const entitlements = session?.state === 'authenticated' ? session.entitlements : null;
    return {
      session,
      entitlements,
      isAdmin: entitlements?.role === 'admin',
      refresh,
      requestCode: (email) => api.requestCode(email),
      verifyCode: async (email, code) => apply(await api.verifyCode(email, code)),
      signOut: async () => {
        try {
          await api.logout();
        } finally {
          forgetUserData();
          apply({ state: 'anonymous' });
        }
      },
      setConsent: async (v) => apply(await api.setConsent(v)),
      deleteAccount: async () => {
        await api.deleteAccount();
        forgetUserData();
        apply({ state: 'anonymous' });
      },
      adminSetPlan: async (plan) => apply(await api.adminSetPlan(plan)),
      adminResetQuota: async () => apply(await api.adminResetQuota()),
    };
  }, [session, refresh, apply]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
