import type { InputHTMLAttributes } from 'react';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-10 w-full rounded-md border border-white/10 bg-surface px-3 text-sm text-zinc-100 placeholder:text-zinc-500 transition focus:border-accent focus:outline-2 focus:outline-accent/40 focus:outline-offset-1 ${className}`}
      {...props}
    />
  );
}
