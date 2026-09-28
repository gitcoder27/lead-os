import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';

type ToastType = 'error' | 'success' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  duration?: number;
}

interface ToastContextValue {
  addToast: {
    (toast: Omit<Toast, 'id'>): void;
    (title: string, type?: ToastType, message?: string): void;
  };
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextValue>({
  addToast: () => {},
  removeToast: () => {},
  clearToasts: () => {},
});

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const addToast = useCallback(
    (toastInput: Omit<Toast, 'id'> | string, type: ToastType = 'info', message?: string) => {
      const toast = normalizeToast(toastInput, type, message);
      const id = `toast-${++toastCounter}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      const duration = toast.duration ?? 5000;
      if (duration > 0) {
        setTimeout(() => removeToast(id), duration);
      }
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ addToast, removeToast, clearToasts }}>
      {children}
      <div className="fixed top-4 right-4 z-toast flex flex-col gap-2 max-w-sm" role="status" aria-live="polite" aria-atomic="false">
        <AnimatePresence>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const iconMap = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info,
  warning: AlertCircle,
};

// docs/54 V13: tone colours only — the card itself is the app's elevated surface.
const colorMap = {
  error: { icon: 'var(--danger)' },
  success: { icon: 'var(--success)' },
  info: { icon: 'var(--accent)' },
  warning: { icon: 'var(--warning)' },
};

function normalizeToast(
  toastInput: Omit<Toast, 'id'> | string,
  type: ToastType = 'info',
  message?: string,
): Omit<Toast, 'id'> {
  if (typeof toastInput === 'string') {
    return { type, title: toastInput, ...(message !== undefined ? { message } : {}) };
  }

  if (!toastInput || typeof toastInput !== 'object' || !('type' in toastInput) || typeof toastInput.type !== 'string') {
    return { type: 'info', title: 'Notification' };
  }

  if (!(toastInput.type in colorMap)) {
    return { ...toastInput, type: 'info' };
  }

  return toastInput;
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const Icon = iconMap[toast.type];
  const colors = colorMap[toast.type];

  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex items-start gap-3 overflow-hidden rounded-xl py-2.5 pl-4 pr-2.5"
      style={{
        ['--tone' as string]: colors.icon,
        background: 'var(--bg-elevated)',
        boxShadow: 'var(--overlay-shadow), inset 0 0 0 1px var(--border)',
        minWidth: 280,
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: 'var(--tone)' }} />
      <Icon size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--tone)' }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          {toast.title}
        </p>
        {toast.message && (
          <p className="mt-0.5 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
            {toast.message}
          </p>
        )}
        {toast.action && (
          <button type="button" onClick={toast.action.onClick} className="ui-btn ui-btn-sm mt-1.5">
            {toast.action.label}
          </button>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="ui-icon-btn h-6 w-6" aria-label="Dismiss notification">
        <X size={12} />
      </button>
    </motion.div>
  );
}
