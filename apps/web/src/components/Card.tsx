import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-white/10 bg-surface p-6 shadow-sm ${className}`}
      {...props}
    />
  );
}
