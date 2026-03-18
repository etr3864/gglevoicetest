import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn } from '../../lib/cn';

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: string;
  error?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, error, className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);

    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium text-[var(--text-secondary)]">{label}</label>
        )}
        <div className="relative">
          <input
            ref={ref}
            type={visible ? 'text' : 'password'}
            className={cn(
              'w-full px-3 py-2 pl-9 rounded-lg text-sm',
              'bg-[var(--bg-primary)] border',
              error ? 'border-red-500/60' : 'border-[var(--border)]',
              'text-[var(--text-primary)] placeholder:text-[var(--text-muted)]',
              'focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30',
              'transition-colors',
              className
            )}
            {...props}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setVisible(v => !v)}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);
PasswordInput.displayName = 'PasswordInput';
