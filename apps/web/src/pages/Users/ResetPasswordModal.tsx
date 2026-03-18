import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { PasswordInput } from '../../components/ui/PasswordInput';

interface Props {
  userName: string;
  loading?: boolean;
  onSubmit: (password: string) => void;
  onClose: () => void;
}

export default function ResetPasswordModal({ userName, loading, onSubmit, onClose }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError('סיסמה חייבת להכיל לפחות 8 תווים');
      return;
    }
    onSubmit(password);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">איפוס סיסמה — {userName}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordInput
            label="סיסמה חדשה"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(''); }}
            error={error}
            required
            dir="ltr"
            placeholder="לפחות 8 תווים"
          />
          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'מאפס...' : 'איפוס סיסמה'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>ביטול</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
