import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PasswordInput } from '../components/ui/PasswordInput';

const LOGO_WHITE =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763910407/white_logoggfdsdfgdfsgds_bdqrww.png';
const TENTACLE_1 =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763893433/ChatGPT_Image_Nov_23_2025_12_23_46_PM_tqfwov.png';
const TENTACLE_2 =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763892372/ChatGPT_Image_Nov_23_2025_12_03_35_PM_mze4yt.png';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    navigate('/', { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch {
      setError('אימייל או סיסמה שגויים');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_60%,rgba(139,92,246,0.12)_0%,transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_20%,rgba(109,40,217,0.08)_0%,transparent_50%)]" />

      {/* Tentacle 1 — bottom right */}
      <img
        src={TENTACLE_1}
        alt=""
        aria-hidden
        className="absolute bottom-0 right-0 w-[480px] opacity-20 select-none pointer-events-none"
        style={{ filter: 'hue-rotate(200deg) saturate(1.2)' }}
      />

      {/* Tentacle 2 — top left, mirrored */}
      <img
        src={TENTACLE_2}
        alt=""
        aria-hidden
        className="absolute top-0 left-0 w-[400px] opacity-15 select-none pointer-events-none"
        style={{ filter: 'hue-rotate(200deg) saturate(1.2)', transform: 'scaleX(-1) rotate(180deg)' }}
      />

      <div className="w-full max-w-sm relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <img
            src={LOGO_WHITE}
            alt="Optive"
            className="h-12 mx-auto mb-4 select-none"
            draggable={false}
          />
          <p className="text-[var(--text-secondary)] text-sm">
            פלטפורמת סוכני Voice AI
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]/90 backdrop-blur-md p-7 shadow-[0_0_60px_rgba(139,92,246,0.08)]">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="אימייל"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@optive.com"
              required
              dir="ltr"
            />
            <PasswordInput
              label="סיסמה"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••"
              required
              dir="ltr"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full mt-2">
              {loading ? 'מתחבר...' : 'התחבר'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
