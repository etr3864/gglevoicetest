import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, className, ...props }, ref) => (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-[var(--text-secondary)]">{label}</label>
      )}
      <input
        ref={ref}
        className={cn(
          'w-full px-3 py-2 rounded-lg text-sm',
          'bg-[var(--bg-primary)] border border-[var(--border)]',
          'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
          'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30',
          'transition-colors',
          className
        )}
        {...props}
      />
    </div>
  )
);
Input.displayName = 'Input';
