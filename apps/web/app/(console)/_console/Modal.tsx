'use client';

/* Inline form panel — renders IN the content area (under the page header), not as an overlay/popup.
   The list view swaps to this when creating/editing. Styled in console.css (.form-shell*). */
export function FormShell({ title, subtitle, onClose, children, footer, width }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; width?: number }) {
  return (
    <div className="form-shell" style={width ? { maxWidth: width } : undefined}>
      <div className="form-shell__hd">
        <div><div className="form-shell__title">{title}</div>{subtitle && <div className="form-shell__sub">{subtitle}</div>}</div>
        <button className="form-shell__x" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="form-shell__body">{children}</div>
      {footer && <div className="form-shell__ft">{footer}</div>}
    </div>
  );
}

/* Small labeled field wrapper used by the CRUD forms. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="fld"><label>{label}</label>{children}</div>;
}
