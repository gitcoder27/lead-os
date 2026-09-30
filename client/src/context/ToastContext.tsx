import { createContext, useContext, useState, useCallback, useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react';

type ToastType = 'error' | 'success' | 'info' | 'warning';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
  /** Milliseconds before it dismisses itself; `0` keeps it until dismissed. Default: 5s, and errors persist. */
  duration?: number;
}

/** A toast in the stack. `nonce` bumps when an identical toast is raised again, which restarts its timer. */
interface StackedToast extends Toast {
  nonce: number;
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

const DEFAULT_DURATION_MS = 5000;

/**
 * docs/56 P7-01: a timed toast is a poor way to report a failure (it can vanish before it is
 * read or reached by keyboard), so errors stay until dismissed unless a caller says otherwise.
 */
function resolveDuration(toast: Pick<Toast, 'type' | 'duration'>): number {
  if (toast.duration !== undefined) return toast.duration;
  return toast.type === 'error' ? 0 : DEFAULT_DURATION_MS;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<StackedToast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const addToast = useCallback(
    (toastInput: Omit<Toast, 'id'> | string, type: ToastType = 'info', message?: string) => {
      const toast = normalizeToast(toastInput, type, message);
      setToasts((prev) => {
        // The same failure raised again (a retry loop, a repeated click) must not pile up
        // persistent copies: keep one and restart its timer.
        const twin = prev.find((t) => t.type === toast.type && t.title === toast.title && t.message === toast.message);
        if (twin) {
          return prev.map((t) => (t.id === twin.id ? { ...t, ...toast, nonce: t.nonce + 1 } : t));
        }
        return [...prev, { ...toast, id: `toast-${++toastCounter}`, nonce: 0 }];
      });
    },
    []
  );

  // Errors sit in their own stack (top), each announced assertively as it appears; the rest share one
  // polite live region.
  const alerts = toasts.filter((toast) => toast.type === 'error');
  const notices = toasts.filter((toast) => toast.type !== 'error');

  return (
    <ToastContext.Provider value={{ addToast, removeToast, clearToasts }}>
      {children}
      <div className="fixed top-4 right-4 z-toast flex flex-col gap-2 max-w-sm">
        <div className="flex flex-col gap-2" data-testid="toast-alerts">
          <AnimatePresence>
            {alerts.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
            ))}
          </AnimatePresence>
        </div>
        <div className="flex flex-col gap-2" role="status" aria-live="polite" aria-atomic="false">
          <AnimatePresence>
            {notices.map((toast) => (
              <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
            ))}
          </AnimatePresence>
        </div>
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

/**
 * Counts down `duration` while neither hovered nor focused. Leaving resumes with the time that
 * was left, so reading a toast (or tabbing to its button) never costs it its full window.
 */
function useToastTimer(toast: StackedToast, onDismiss: () => void) {
  const duration = resolveDuration(toast);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Declared before the countdown so a restart (new nonce or duration) resets the budget after the
  // previous countdown's cleanup has settled its elapsed time.
  useEffect(() => {
    remaining.current = duration;
  }, [duration, toast.nonce]);

  useEffect(() => {
    if (duration <= 0 || paused) return undefined;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismissRef.current(), Math.max(0, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, duration, toast.nonce]);

  return {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    },
  };
}

function ToastItem({ toast, onDismiss }: { toast: StackedToast; onDismiss: () => void }) {
  const Icon = iconMap[toast.type];
  const colors = colorMap[toast.type];
  const pauseHandlers = useToastTimer(toast, onDismiss);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onDismiss();
    }
  };

  return (
    <motion.div
      role={toast.type === 'error' ? 'alert' : undefined}
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
      {...pauseHandlers}
      onKeyDown={handleKeyDown}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: 'var(--tone)' }} />
      <Icon size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--tone)' }} aria-hidden="true" />
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
