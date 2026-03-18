import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastCtx {
  toast: (message: string, type?: Toast['type']) => void;
}

const Ctx = createContext<ToastCtx | null>(null);
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg backdrop-blur-md text-sm animate-slide-up ${
              t.type === 'success' ? 'bg-[var(--accent)]/15 border-[var(--accent)]/30 text-[var(--accent)]' :
              t.type === 'error' ? 'bg-red-500/15 border-red-500/30 text-red-300' :
              'bg-[var(--bg-card)]/90 border-[var(--border)] text-[var(--text-primary)]'
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
