import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import AgentListPage from './pages/Agent/AgentListPage';
import AgentDetailPage from './pages/Agent/AgentDetailPage';
import AdminPage from './pages/Admin/AdminPage';
import Layout from './components/Layout';

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

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<AgentListPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="database" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}
