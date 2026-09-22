import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary:
    'bg-accent text-zinc-950 font-semibold shadow-glow hover:bg-accent-strong disabled:opacity-50 disabled:shadow-none disabled:hover:bg-accent',
  secondary:
    'border border-white/10 text-zinc-200 hover:border-accent/40 disabled:opacity-50 disabled:hover:border-white/10',
  ghost: 'text-zinc-400 hover:text-zinc-200 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
