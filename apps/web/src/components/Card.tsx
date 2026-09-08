import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-zinc-800 bg-zinc-900 p-5 ${className}`}
      {...props}
    />
  );
}
