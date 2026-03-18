import { Outlet, NavLink } from 'react-router-dom';
import { Bot, Database, LogOut, Users, LayoutDashboard } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/cn';
import type { UserRole } from '@voice/shared';

const LOGO_WHITE =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763910407/white_logoggfdsdfgdfsgds_bdqrww.png';
const TENTACLE =
  'https://res.cloudinary.com/daowx6msw/image/upload/v1763893433/ChatGPT_Image_Nov_23_2025_12_23_46_PM_tqfwov.png';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Bot;
  roles: UserRole[];
}

const navItems: NavItem[] = [
  { to: '/', label: 'סוכנים', icon: Bot, roles: ['super_admin', 'admin', 'employee'] },
  { to: '/dashboard', label: 'דשבורד', icon: LayoutDashboard, roles: ['super_admin', 'admin'] },
  { to: '/users', label: 'משתמשים', icon: Users, roles: ['super_admin', 'admin'] },
  { to: '/database', label: 'Database', icon: Database, roles: ['super_admin'] },
];

export default function Layout() {
  const { logout, user, hasRole } = useAuth();

  const visibleNav = navItems.filter(item => hasRole(...item.roles));

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-hidden">
      <img
        src={TENTACLE}
        alt=""
        aria-hidden
        className="fixed bottom-0 right-0 w-[600px] opacity-[0.07] select-none pointer-events-none z-0"
        style={{ filter: 'sepia(1) saturate(4) hue-rotate(220deg) brightness(0.6)' }}
      />

      <header className="bg-[var(--bg-secondary)]/80 backdrop-blur-md border-b border-[var(--border)] px-6 sticky top-0 z-40">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-4">
            <img
              src={LOGO_WHITE}
              alt="Optive"
              className="h-7 select-none"
              draggable={false}
            />
            <span className="h-5 w-px bg-[var(--border)]" />
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-hover)]/60 text-sm">
              <span className="text-[var(--text-primary)] font-medium">{user?.email?.split('@')[0]}</span>
              <span className="text-[var(--text-muted)]">
                {user?.role === 'super_admin' ? 'מנהל מערכת' : user?.role === 'admin' ? 'לקוח' : 'עובד'}
              </span>
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
            {visibleNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-[var(--accent)]/10 text-[var(--accent)] shadow-[inset_0_0_0_1px_rgba(139,92,246,0.25)]'
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

      <main className="flex-1 p-6 relative z-10">
        <Outlet />
      </main>
    </div>
  );
}
