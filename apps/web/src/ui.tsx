import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { IconAlert, IconChevronLeft, IconFacebook, IconInstagram, IconWhatsApp, IconX } from './icons';
import type { ChannelType } from './api';

/* ------------------------------ Channel helpers ------------------------------ */

export const CHANNEL_LABEL: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  messenger: 'Messenger'
};

export function ChannelIcon({ channel, className }: { channel: ChannelType; className?: string }) {
  if (channel === 'whatsapp') return <IconWhatsApp className={className} />;
  if (channel === 'instagram') return <IconInstagram className={className} />;
  return <IconFacebook className={className} />;
}

const AVATAR_TINTS = ['#D2EDE6', '#FBE7EE', '#E3F0F7', '#F7ECD9', '#E1F3E9'];
const AVATAR_TEXTS = ['#145B50', '#C1355E', '#2C6E8F', '#8A5B17', '#1F7A4D'];

export function avatarColors(seed: string): { bg: string; fg: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const idx = h % AVATAR_TINTS.length;
  return { bg: AVATAR_TINTS[idx], fg: AVATAR_TEXTS[idx] };
}

export function Avatar({ name, seed, mini, miniChannel }: { name: string; seed: string; mini?: ReactNode; miniChannel?: ChannelType }) {
  const initials = (name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const colors = avatarColors(seed);
  return (
    <span className="avatar" style={{ background: colors.bg, color: colors.fg }} aria-hidden="true">
      {initials || '?'}
      {mini}
      {miniChannel && (
        <span className="mini-channel">
          <ChannelIcon channel={miniChannel} />
        </span>
      )}
    </span>
  );
}

/* ------------------------------ Layout pieces ------------------------------ */

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-8 items-center">{actions}</div>}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBanner({ text }: { text: string }) {
  return (
    <div className="error-banner" role="alert">
      <IconAlert />
      <span>{text}</span>
    </div>
  );
}

export function InfoBanner({ children }: { children: ReactNode }) {
  return (
    <div className="info-banner">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} style={{ marginTop: 2, flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span>{children}</span>
    </div>
  );
}

export function EmptyState({ icon, title, sub, action }: { icon: ReactNode; title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <div className="empty-title">{title}</div>
      <div className="empty-sub">{sub}</div>
      {action}
    </div>
  );
}

export function StatusChip({ status }: { status: 'active' | 'disconnected' | 'expired' }) {
  const label = status === 'active' ? 'Connected' : status === 'expired' ? 'Token expired' : 'Disconnected';
  return (
    <span className={`status-chip`}>
      <span className={`status-dot ${status}`} />
      {label}
    </span>
  );
}

/* ------------------------------ Modal ------------------------------ */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="icon-btn back-btn" onClick={onClick} aria-label="Back">
      <IconChevronLeft />
    </button>
  );
}

/* ------------------------------ Copy row ------------------------------ */

export function CopyRow({ value, mono = true }: { value: string; mono?: boolean }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard API unavailable — user can still select the text manually
    }
  };
  return (
    <div className="copy-row">
      <code className={mono ? '' : ''}>{value}</code>
      <button className="copy-btn" onClick={copy} type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" width={14} height={14}>
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        Copy
      </button>
    </div>
  );
}
