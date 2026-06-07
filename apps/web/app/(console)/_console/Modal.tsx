'use client';
import { useEffect } from 'react';

/* Reusable console modal — backdrop + card, Esc / backdrop-click to close. Styled in console.css
   (.modal*) to match the existing card system, so every CRUD form looks native. */
export function Modal({ title, onClose, children, footer, width }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={width ? { width: `min(${width}px, 96vw)` } : undefined}>
        <div className="modal__hd"><span className="modal__title">{title}</span><button className="modal__x" onClick={onClose} aria-label="Close">×</button></div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__ft">{footer}</div>}
      </div>
    </div>
  );
}

/* Small labeled field wrappers used by the CRUD forms. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld"><label>{label}</label>{children}</div>;
}
