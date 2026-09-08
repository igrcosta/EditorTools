import type { ReactNode } from 'react';

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-300"
    >
      {children}
    </div>
  );
}
