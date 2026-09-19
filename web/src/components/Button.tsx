import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

const variants: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-300',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 focus:ring-slate-200',
  danger: 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-200',
  ghost: 'text-slate-600 hover:bg-slate-100 focus:ring-slate-200',
};

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={
        `inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm ` +
        `font-medium transition focus:outline-none focus:ring-2 ` +
        `disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${className}`.trim()
      }
    />
  );
}
