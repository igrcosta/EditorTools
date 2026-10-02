import type { HTMLAttributes } from 'react';

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`panel rounded-xl p-6 ${className}`}
      {...props}
    />
  );
}
