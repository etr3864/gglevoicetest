import { Outlet, NavLink } from 'react-router-dom';
import { Bot, Database, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/cn';

const navItems = [
  { to: '/', label: 'סוכנים', icon: Bot },
  { to: '/database', label: 'Database', icon: Database },
];

export default function Layout() {
  const { logout, user } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-[var(--bg-secondary)]/80 backdrop-blur-md border-b border-[var(--border)] px-6 sticky top-0 z-40">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold tracking-widest text-[var(--accent)] drop-shadow-[0_0_12px_var(--accent-glow)]">
              VOICE AI
            </h1>
            <span className="h-5 w-px bg-[var(--border)]" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-hover)]/60 text-sm">
              <span className="text-[var(--text-primary)] font-medium">{user?.email?.split('@')[0]}</span>
              <span className="text-[var(--text-muted)]">מנהל</span>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="התנתק"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            {navItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(16,185,129,0.2)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                  )
                }
              >
                <Icon className="w-4 h-4" />
                {label}
              </NavLink>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
