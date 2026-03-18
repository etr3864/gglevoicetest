import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, KeyRound, Building2, UserCheck, UserX, Bot, User } from 'lucide-react';
import api from '../../lib/api';
import { useAuth } from '../../hooks/useAuth';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import UserFormModal, { type UserFormData } from './UserFormModal';
import ResetPasswordModal from './ResetPasswordModal';
import AgentAssignModal from './AgentAssignModal';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  companyName: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { agents: number };
  parentName?: string;
}

type Tab = 'super-admins' | 'admins' | 'employees';

type ModalState =
  | { type: 'create-super-admin' }
  | { type: 'create-admin' }
  | { type: 'create-employee' }
  | { type: 'edit-admin'; user: UserRow }
  | { type: 'edit-employee'; user: UserRow }
  | { type: 'reset-password'; user: UserRow; endpoint: string }
  | { type: 'assign-agents'; user: UserRow }
  | null;

export default function UsersPage() {
  const { isSuperAdmin, user: me } = useAuth();
  const [tab, setTab] = useState<Tab>(isSuperAdmin ? 'admins' : 'employees');
  const [superAdmins, setSuperAdmins] = useState<UserRow[]>([]);
  const [admins, setAdmins] = useState<UserRow[]>([]);
  const [employees, setEmployees] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  const fetchSuperAdmins = useCallback(async () => {
    if (!isSuperAdmin) return;
    const res = await api.get('/auth/super-admins');
    setSuperAdmins(res.data.data);
  }, [isSuperAdmin]);

  const fetchAdmins = useCallback(async () => {
    if (!isSuperAdmin) return;
    const res = await api.get('/auth/admins');
    setAdmins(res.data.data);
  }, [isSuperAdmin]);

  const fetchEmployees = useCallback(async () => {
    const res = await api.get('/auth/employees');
    setEmployees(res.data.data);
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSuperAdmins(), fetchAdmins(), fetchEmployees()]).finally(() => setLoading(false));
  }, [fetchSuperAdmins, fetchAdmins, fetchEmployees]);

  async function withSave(fn: () => Promise<void>) {
    setSaving(true);
    try { await fn(); } finally { setSaving(false); }
  }

  async function handleCreateSuperAdmin(data: UserFormData) {
    await withSave(async () => {
      await api.post('/auth/super-admins', data);
      await fetchSuperAdmins();
      setModal(null);
    });
  }

  async function handleCreateAdmin(data: UserFormData) {
    await withSave(async () => {
      await api.post('/auth/admins', data);
      await fetchAdmins();
      setModal(null);
    });
  }

  async function handleCreateEmployee(data: UserFormData) {
    await withSave(async () => {
      await api.post('/auth/employees', data);
      await fetchEmployees();
      setModal(null);
    });
  }

  async function handleEditAdmin(user: UserRow, data: UserFormData) {
    await withSave(async () => {
      await api.put(`/auth/admins/${user.id}`, { name: data.name, companyName: data.companyName || null, phone: data.phone || null });
      await fetchAdmins();
      setModal(null);
    });
  }

  async function handleEditEmployee(user: UserRow, data: UserFormData) {
    await withSave(async () => {
      await api.put(`/auth/employees/${user.id}`, { name: data.name });
      await fetchEmployees();
      setModal(null);
    });
  }

  async function handleDelete(user: UserRow, type: 'super-admin' | 'admin' | 'employee') {
    if (!confirm(`למחוק את ${user.name || user.email}?`)) return;
    const endpoint = type === 'super-admin' ? 'super-admins' : type === 'admin' ? 'admins' : 'employees';
    await api.delete(`/auth/${endpoint}/${user.id}`);
    if (type === 'super-admin') await fetchSuperAdmins();
    else if (type === 'admin') await fetchAdmins();
    else await fetchEmployees();
  }

  async function handleToggleActive(user: UserRow, type: 'admin' | 'employee') {
    const endpoint = type === 'admin' ? 'admins' : 'employees';
    await api.put(`/auth/${endpoint}/${user.id}`, { isActive: !user.isActive });
    type === 'admin' ? await fetchAdmins() : await fetchEmployees();
  }

  async function handleResetPassword(password: string) {
    if (modal?.type !== 'reset-password') return;
    await withSave(async () => {
      await api.put(modal.endpoint, { password });
      setModal(null);
    });
  }

  const tabs: { key: Tab; label: string }[] = isSuperAdmin
    ? [
        { key: 'admins', label: 'לקוחות' },
        { key: 'employees', label: 'עובדים' },
        { key: 'super-admins', label: 'צוות Optive' },
      ]
    : [{ key: 'employees', label: 'העובדים שלי' }];

  const currentList =
    tab === 'super-admins' ? superAdmins :
    tab === 'admins' ? admins :
    employees;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">ניהול משתמשים</h1>
        <div className="flex gap-2">
          {tab === 'super-admins' && isSuperAdmin && (
            <Button size="sm" onClick={() => setModal({ type: 'create-super-admin' })}>
              <Plus className="w-4 h-4" />
              חבר צוות חדש
            </Button>
          )}
          {tab === 'admins' && isSuperAdmin && (
            <Button size="sm" onClick={() => setModal({ type: 'create-admin' })}>
              <Plus className="w-4 h-4" />
              לקוח חדש
            </Button>
          )}
          {tab === 'employees' && (
            <Button size="sm" onClick={() => setModal({ type: 'create-employee' })}>
              <Plus className="w-4 h-4" />
              עובד חדש
            </Button>
          )}
        </div>
      </div>

      {tabs.length > 1 && (
        <div className="flex gap-1 p-1 rounded-lg bg-[var(--bg-secondary)] w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-[var(--text-muted)]">טוען...</div>
      ) : currentList.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          {tab === 'super-admins' ? 'אין חברי צוות' : tab === 'admins' ? 'אין לקוחות עדיין' : 'אין עובדים עדיין'}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[var(--bg-secondary)]/60 text-[var(--text-secondary)]">
                <th className="text-right px-4 py-3 font-medium">שם</th>
                <th className="text-right px-4 py-3 font-medium">אימייל</th>
                {tab === 'admins' && <th className="text-right px-4 py-3 font-medium">חברה</th>}
                {tab === 'admins' && <th className="text-right px-4 py-3 font-medium">סוכנים</th>}
                {tab === 'employees' && isSuperAdmin && <th className="text-right px-4 py-3 font-medium">לקוח</th>}
                {tab !== 'super-admins' && <th className="text-right px-4 py-3 font-medium">סטטוס</th>}
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {currentList.map(u => (
                <tr key={u.id} className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]/40 transition-colors">
                  <td className="px-4 py-3 font-medium">{u.name || '—'}</td>
                  <td className="px-4 py-3 text-[var(--text-secondary)]" dir="ltr">{u.email}</td>
                  {tab === 'admins' && (
                    <td className="px-4 py-3">
                      {u.companyName ? (
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                          <Building2 className="w-3.5 h-3.5" />
                          {u.companyName}
                        </span>
                      ) : '—'}
                    </td>
                  )}
                  {tab === 'admins' && (
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{u._count?.agents ?? 0}</td>
                  )}
                  {tab === 'employees' && isSuperAdmin && (
                    <td className="px-4 py-3">
                      {u.parentName ? (
                        <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                          <User className="w-3.5 h-3.5 shrink-0" />
                          {u.parentName}
                        </span>
                      ) : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                  )}
                  {tab !== 'super-admins' && (
                    <td className="px-4 py-3">
                      <Badge variant={u.isActive ? 'success' : 'danger'}>
                        {u.isActive ? 'פעיל' : 'מושבת'}
                      </Badge>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {tab === 'admins' && (
                        <>
                          <button
                            onClick={() => setModal({ type: 'assign-agents', user: u })}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                            title="שייך סוכנים"
                          >
                            <Bot className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleToggleActive(u, 'admin')}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title={u.isActive ? 'השבת' : 'הפעל'}
                          >
                            {u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setModal({ type: 'edit-admin', user: u })}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title="ערוך"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setModal({ type: 'reset-password', user: u, endpoint: `/auth/admins/${u.id}/password` })}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title="איפוס סיסמה"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(u, 'admin')}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                            title="מחק"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {tab === 'employees' && (
                        <>
                          <button
                            onClick={() => handleToggleActive(u, 'employee')}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title={u.isActive ? 'השבת' : 'הפעל'}
                          >
                            {u.isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => setModal({ type: 'edit-employee', user: u })}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title="ערוך"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setModal({ type: 'reset-password', user: u, endpoint: `/auth/employees/${u.id}/password` })}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
                            title="איפוס סיסמה"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(u, 'employee')}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                            title="מחק"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                      {tab === 'super-admins' && u.id !== me?.userId && (
                        <button
                          onClick={() => handleDelete(u, 'super-admin')}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
                          title="מחק"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {modal?.type === 'create-super-admin' && (
        <UserFormModal
          title="חבר צוות Optive חדש"
          loading={saving}
          onSubmit={handleCreateSuperAdmin}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'create-admin' && (
        <UserFormModal
          title="לקוח חדש"
          showCompany
          showPhone
          loading={saving}
          onSubmit={handleCreateAdmin}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'create-employee' && (
        <UserFormModal
          title="עובד חדש"
          loading={saving}
          onSubmit={handleCreateEmployee}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'edit-admin' && (
        <UserFormModal
          title={`עריכת לקוח — ${modal.user.name || modal.user.email}`}
          initial={{ name: modal.user.name || '', companyName: modal.user.companyName || '', phone: modal.user.phone || '' }}
          showCompany
          showPhone
          isEdit
          loading={saving}
          onSubmit={(data) => handleEditAdmin(modal.user, data)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'edit-employee' && (
        <UserFormModal
          title={`עריכת עובד — ${modal.user.name || modal.user.email}`}
          initial={{ name: modal.user.name || '' }}
          isEdit
          loading={saving}
          onSubmit={(data) => handleEditEmployee(modal.user, data)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'reset-password' && (
        <ResetPasswordModal
          userName={modal.user.name || modal.user.email}
          loading={saving}
          onSubmit={handleResetPassword}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'assign-agents' && (
        <AgentAssignModal
          adminId={modal.user.id}
          adminName={modal.user.name || modal.user.email}
          onClose={() => { setModal(null); fetchAdmins(); }}
        />
      )}
    </div>
  );
}
