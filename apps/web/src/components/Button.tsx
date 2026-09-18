import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary:
    'bg-accent text-zinc-950 font-medium shadow-sm hover:bg-accent-strong disabled:opacity-50 disabled:shadow-none disabled:hover:bg-accent',
  secondary:
    'border border-zinc-700 text-zinc-200 hover:border-zinc-500 disabled:opacity-50 disabled:hover:border-zinc-700',
  ghost: 'text-zinc-400 hover:text-zinc-200 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md px-4 text-sm transition-colors disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
