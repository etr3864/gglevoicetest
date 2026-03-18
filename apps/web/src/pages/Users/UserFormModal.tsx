import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';

export interface UserFormData {
  email: string;
  password: string;
  name: string;
  companyName?: string;
  phone?: string;
}

interface Props {
  title: string;
  initial?: Partial<UserFormData>;
  showCompany?: boolean;
  showPhone?: boolean;
  isEdit?: boolean;
  loading?: boolean;
  onSubmit: (data: UserFormData) => void;
  onClose: () => void;
}

export default function UserFormModal({ title, initial, showCompany, showPhone, isEdit, loading, onSubmit, onClose }: Props) {
  const [form, setForm] = useState<UserFormData>({
    email: initial?.email || '',
    password: '',
    name: initial?.name || '',
    companyName: initial?.companyName || '',
    phone: initial?.phone || '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!form.name || form.name.length < 2) errs.name = 'שם חייב להכיל לפחות 2 תווים';
    if (!isEdit && !form.email) errs.email = 'אימייל נדרש';
    if (!isEdit && form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'אימייל לא תקין';
    if (!isEdit && (!form.password || form.password.length < 8)) errs.password = 'סיסמה חייבת להכיל לפחות 8 תווים';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (validate()) onSubmit(form);
  }

  const set = (field: keyof UserFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setErrors(prev => ({ ...prev, [field]: '' }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Input label="שם מלא" value={form.name} onChange={set('name')} required />
            {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
          </div>

          {!isEdit && (
            <div>
              <Input label="אימייל" type="email" value={form.email} onChange={set('email')} required dir="ltr" />
              {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email}</p>}
            </div>
          )}

          {!isEdit && (
            <PasswordInput
              label="סיסמה"
              value={form.password}
              onChange={set('password')}
              error={errors.password}
              required
              dir="ltr"
              placeholder="לפחות 8 תווים"
            />
          )}

          {showCompany && (
            <Input label="שם חברה" value={form.companyName || ''} onChange={set('companyName')} />
          )}

          {showPhone && (
            <Input label="טלפון" value={form.phone || ''} onChange={set('phone')} dir="ltr" />
          )}

          <div className="flex gap-3 pt-2">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? 'שומר...' : isEdit ? 'עדכן' : 'צור'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>ביטול</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
