/**
 * OmniFlow icon set — inline SVG, 24px grid, stroke-based (brand glyphs filled).
 * Keeps the bundle dependency-free and consistent with Evergreen Mist.
 */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Stroke({ children, ...props }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconHome = (p: P) => (
  <Stroke {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.8V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.8" />
  </Stroke>
);

export const IconInbox = (p: P) => (
  <Stroke {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Stroke>
);

export const IconPeople = (p: P) => (
  <Stroke {...p}>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Stroke>
);

export const IconBolt = (p: P) => (
  <Stroke {...p}>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </Stroke>
);

export const IconPlug = (p: P) => (
  <Stroke {...p}>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z" />
  </Stroke>
);

export const IconSettings = (p: P) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </Stroke>
);

export const IconSend = (p: P) => (
  <Stroke {...p}>
    <path d="m22 2-7 20-4-9-9-4z" />
    <path d="M22 2 11 13" />
  </Stroke>
);

export const IconSearch = (p: P) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Stroke>
);

export const IconPlus = (p: P) => (
  <Stroke {...p}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Stroke>
);

export const IconX = (p: P) => (
  <Stroke {...p}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Stroke>
);

export const IconCheck = (p: P) => (
  <Stroke {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Stroke>
);

export const IconCheckDouble = (p: P) => (
  <Stroke {...p}>
    <path d="M18 7 9.5 18 3 11.5" />
    <path d="m22 9-7 8.2" />
  </Stroke>
);

export const IconAlert = (p: P) => (
  <Stroke {...p}>
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Stroke>
);

export const IconInfo = (p: P) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </Stroke>
);

export const IconClock = (p: P) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </Stroke>
);

export const IconCopy = (p: P) => (
  <Stroke {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Stroke>
);

export const IconEye = (p: P) => (
  <Stroke {...p}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </Stroke>
);

export const IconEyeOff = (p: P) => (
  <Stroke {...p}>
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <path d="m1 1 22 22" />
  </Stroke>
);

export const IconTrash = (p: P) => (
  <Stroke {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </Stroke>
);

export const IconEdit = (p: P) => (
  <Stroke {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </Stroke>
);

export const IconLogout = (p: P) => (
  <Stroke {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Stroke>
);

export const IconChevronLeft = (p: P) => (
  <Stroke {...p}>
    <path d="m15 18-6-6 6-6" />
  </Stroke>
);

export const IconChevronRight = (p: P) => (
  <Stroke {...p}>
    <path d="m9 18 6-6-6-6" />
  </Stroke>
);

export const IconRefresh = (p: P) => (
  <Stroke {...p}>
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </Stroke>
);

export const IconUserCheck = (p: P) => (
  <Stroke {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="8.5" cy="7" r="4" />
    <path d="m17 11 2 2 4-4" />
  </Stroke>
);

export const IconBot = (p: P) => (
  <Stroke {...p}>
    <rect x="3" y="8" width="18" height="12" rx="3" />
    <path d="M12 8V4" />
    <path d="M9 14h.01" />
    <path d="M15 14h.01" />
    <path d="M8 3h8" />
    <path d="M9 17.5h6" />
  </Stroke>
);

export const IconMessage = (p: P) => (
  <Stroke {...p}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </Stroke>
);

export const IconTrend = (p: P) => (
  <Stroke {...p}>
    <path d="m23 6-9.5 9.5-5-5L1 18" />
    <path d="M17 6h6v6" />
  </Stroke>
);

export const IconZapOff = (p: P) => (
  <Stroke {...p}>
    <path d="M2 2l20 20" />
    <path d="M13 2 4.5 12.5H11l-1 7 7.2-8.4" />
    <path d="M20 15.5h-3" />
  </Stroke>
);

/* ---- Brand glyphs (filled, simplified official shapes) ---- */

export const IconWhatsApp = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M12.04 2a9.9 9.9 0 0 0-8.49 14.94L2 22l5.2-1.36A9.9 9.9 0 1 0 12.04 2zm0 1.67a8.23 8.23 0 1 1-4.19 15.32l-.3-.18-3.07.8.82-3-.2-.31a8.23 8.23 0 0 1 6.94-12.63zm-3.4 4.16c-.18 0-.46.06-.7.32-.25.26-.94.92-.94 2.23 0 1.32.95 2.59 1.08 2.76.14.18 1.87 2.98 4.6 4.06 2.27.9 2.73.72 3.23.68.5-.05 1.6-.66 1.82-1.3.23-.63.23-1.17.16-1.28-.06-.11-.24-.18-.5-.31-.27-.14-1.6-.79-1.84-.88-.25-.09-.43-.14-.6.14-.19.26-.65.87-.8 1.05-.14.18-.28.2-.53.07a6.6 6.6 0 0 1-1.96-1.21 7.4 7.4 0 0 1-1.35-1.7c-.14-.26-.02-.4.11-.54.12-.13.28-.34.41-.51.14-.18.19-.31.28-.5.09-.18.05-.34-.02-.48-.07-.13-.6-1.47-.82-2-.2-.48-.4-.42-.55-.43h-.48z" />
  </svg>
);

export const IconInstagram = (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.4" cy="6.6" r="1.15" fill="currentColor" stroke="none" />
  </svg>
);

export const IconFacebook = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}>
    <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z" />
  </svg>
);

/* ---- Brand mark (app logo) ---- */

export const BrandMark = (p: P) => (
  <svg viewBox="0 0 48 48" fill="none" aria-hidden="true" {...p}>
    <rect width="48" height="48" rx="13" fill="#145B50" />
    <path
      d="M24 10c-7.2 0-13 5.5-13 12.3 0 2.4.75 4.7 2.1 6.6L11.5 36l7.6-2.1c1.5.55 3.2.85 4.9.85 7.2 0 13-5.5 13-12.3S31.2 10 24 10z"
      fill="#D2EDE6"
    />
    <path d="M25.9 16.5 19 25.2h5l-1.3 6.6 7-8.8h-5l1.2-6.5z" fill="#145B50" />
  </svg>
);
