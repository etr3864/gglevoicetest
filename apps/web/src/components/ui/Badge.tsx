import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'success' | 'warning' | 'danger' | 'neutral' | 'info';
}

const colorMap = {
  success: 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  danger: 'bg-red-500/15 text-red-400 border-red-500/30',
  neutral: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  info: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
};

export function Badge({ variant = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border', colorMap[variant], className)}
      {...props}
    />
  );
}
