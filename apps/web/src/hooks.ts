import { useEffect, useRef } from 'react';

/**
 * setInterval as a hook with automatic cleanup.
 * Passing null as delay pauses polling.
 */
export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef<() => void>(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}

/** Relative time like "2m ago" / "3h ago" / "5d ago" / "just now". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  if (diff < 45 * 1000) return 'just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Clock time for chat bubbles: 10:42 AM */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Day divider label: Today / Yesterday / 12 Nov */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Hours remaining in the 24h Meta customer care window (null when closed). */
export function careWindowHoursRemaining(lastCustomerMessageAt: string | null | undefined): number | null {
  if (!lastCustomerMessageAt) return null;
  const t = new Date(lastCustomerMessageAt).getTime();
  if (Number.isNaN(t)) return null;
  const remaining = 24 - (Date.now() - t) / 3600000;
  return remaining > 0 ? remaining : null;
}
