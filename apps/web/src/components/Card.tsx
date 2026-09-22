import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-white/10 bg-surface/70 bg-gradient-to-b from-white/[0.04] to-transparent p-6 shadow-sm backdrop-blur-md transition-colors duration-300 hover:border-accent/25 ${className}`}
      {...props}
    />
  );
}
