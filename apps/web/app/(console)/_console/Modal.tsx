'use client';
import { useEffect } from 'react';

/* Right-column slide-in panel for all create/edit/confirm flows (no popups — enterprise pattern).
   Styled in console.css (.drawer*). Esc / scrim-click closes. Same API across every entity. */
export function Drawer({ title, subtitle, onClose, children, footer, width }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="drawer-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="drawer" role="dialog" aria-modal="true" style={width ? { width: `min(${width}px, 96vw)` } : undefined}>
        <div className="drawer__hd">
          <div><div className="drawer__title">{title}</div>{subtitle && <div className="drawer__sub">{subtitle}</div>}</div>
          <button className="drawer__x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="drawer__body">{children}</div>
        {footer && <div className="drawer__ft">{footer}</div>}
      </div>
    </div>
  );
}

/* Small labeled field wrapper used by the CRUD forms. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld"><label>{label}</label>{children}</div>;
}
