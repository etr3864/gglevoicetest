import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import type { UserRole } from '@voice/shared';
import LoginPage from './pages/LoginPage';
import AgentListPage from './pages/Agent/AgentListPage';
import AgentDetailPage from './pages/Agent/AgentDetailPage';
import AdminPage from './pages/Admin/AdminPage';
import UsersPage from './pages/Users/UsersPage';
import DashboardPage from './pages/Dashboard/DashboardPage';
import SuperAdminDashboardPage from './pages/Dashboard/SuperAdminDashboardPage';
import Layout from './components/Layout';
import HomePage from './pages/public/HomePage';
import PrivacyPage from './pages/public/PrivacyPage';
import TermsPage from './pages/public/TermsPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-[var(--text-secondary)]">טוען...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RoleRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: UserRole[] }) {
  const { hasRole } = useAuth();
  if (!hasRole(...allowedRoles)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function DashboardSwitch() {
  const { hasRole } = useAuth();
  return hasRole('super_admin') ? <SuperAdminDashboardPage /> : <DashboardPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/home" element={<HomePage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<AgentListPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="database" element={<RoleRoute allowedRoles={['super_admin']}><AdminPage /></RoleRoute>} />
        <Route path="users" element={<RoleRoute allowedRoles={['super_admin', 'admin']}><UsersPage /></RoleRoute>} />
        <Route path="dashboard" element={<RoleRoute allowedRoles={['super_admin', 'admin']}><DashboardSwitch /></RoleRoute>} />
      </Route>
    </Routes>
  );
}
