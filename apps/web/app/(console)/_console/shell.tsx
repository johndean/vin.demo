'use client';
/* VIN Demo console — shared icon set + shell primitives (ported from web/shell.jsx).
   PageHead is co-located here so the view modules import in one direction. */
import React, { Fragment } from 'react';
import { useRouter } from 'next/navigation';

export type Go = (route: string, param?: string | null) => void;

export const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z',
  product: 'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.3 7L12 12l8.7-5M12 22V12',
  knowledge: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z',
  graph: 'M18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM8.6 13.5l6.8 4M15.4 7.5l-6.8 4',
  environment: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 16a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM7 6.5h.01M7 17.5h.01',
  persona: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  customers: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 5V3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18',
  sessions: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM10 8l6 4-6 4z',
  evals: 'M9 11l3 3 8-8M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  costs: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  safety: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.3A1.6 1.6 0 0 0 10.3 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9.3a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  plus: 'M12 5v14M5 12h14',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  chevR: 'M9 18l6-6-6-6',
  chevD: 'M6 9l6 6 6-6',
  lock: 'M5 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 9V7a4 4 0 0 1 8 0v2',
  lockOpen: 'M5 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 9V7a4 4 0 0 1 7-2.6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  x: 'M18 6 6 18M6 6l12 12',
  play: 'M5 3l14 9-14 9z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  step: 'M5 4l10 8-10 8zM19 5v14',
  restart: 'M1 4v6h6M3.5 9a9 9 0 1 1-1.3 5',
  stop: 'M5 5h14v14H5z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
  spark: 'M12 2l2.4 7.2H22l-6 4.4 2.3 7.2-6.3-4.5L5.7 21 8 13.6 2 9.2h7.6z',
  up: 'M7 17 17 7M7 7h10v10',
  down: 'M7 7l10 10M17 7v10H7',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  dot: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
  check: 'M20 6 9 17l-5-5',
  zap: 'M13 2 3 14h9l-1 8 10-12h-9z',
  layers: 'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  pin: 'M12 22s7-5.8 7-12a7 7 0 1 0-14 0c0 6.2 7 12 7 12zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  archive: 'M21 8v13H3V8M1 3h22v5H1zM10 12h4',
};

export function Icon({ name, size = 16, fill = false, style, cls }: { name: string; size?: number; fill?: boolean; style?: React.CSSProperties; cls?: string }) {
  const d = ICONS[name] || ICONS.dot;
  const solid = fill || ['play', 'pause', 'step', 'stop', 'dot', 'send', 'spark'].includes(name);
  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'} stroke={solid ? 'none' : 'currentColor'}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={d} />
    </svg>
  );
}

export function Pill({ kind = 'neutral', children, dot }: { kind?: string; children: React.ReactNode; dot?: boolean }) {
  return <span className={`pill pill-${kind}`}>{dot && <i className="pdot" />}{children}</span>;
}

export const MODE_META: Record<string, { cls: string; icon: string; label: string }> = {
  'read-only': { cls: 'mode-readonly', icon: 'eye', label: 'Read-only' },
  safe: { cls: 'mode-safe', icon: 'check', label: 'Safe' },
  approval: { cls: 'mode-approval', icon: 'lockOpen', label: 'Approval' },
  execution: { cls: 'mode-execution', icon: 'lock', label: 'Execution' },
};
export function ModeChip({ mode }: { mode: string }) {
  const m = MODE_META[mode] || MODE_META['read-only'];
  return <span className={`mode-chip ${m.cls}`}><Icon name={m.icon} size={11} /> {m.label}</span>;
}

export function ConfBar({ v, max = 130 }: { v: number; max?: number }) {
  const cls = v >= 0.85 ? 'conf-hi' : v >= 0.7 ? 'conf-mid' : 'conf-lo';
  return <span className="conf-bar" style={{ maxWidth: max }}><i className={cls} style={{ width: `${v * 100}%` }} /></span>;
}

export const VALIDATION: Record<string, { kind: string; label: string }> = {
  validated: { kind: 'success', label: 'Validated' },
  'needs-review': { kind: 'warn', label: 'Needs review' },
  stale: { kind: 'danger', label: 'Stale' },
};

export function Metric({ label, value, delta, dir = 'flat', spark }: { label: string; value: React.ReactNode; delta?: React.ReactNode; dir?: string; spark?: number[] }) {
  return (
    <div className="metric">
      <div className="metric__label">{label}</div>
      <div className="metric__val">{value}</div>
      {delta && <div className={`metric__delta ${dir}`}><Icon name={dir === 'down' ? 'down' : dir === 'up' ? 'up' : 'arrow'} size={13} /> {delta}</div>}
      {spark && <Sparkline className="metric__spark" points={spark} dir={dir} />}
    </div>
  );
}

export function Sparkline({ points, dir, className }: { points: number[]; dir?: string; className?: string }) {
  const w = 72, h = 26;
  const max = Math.max(...points), min = Math.min(...points);
  const pts = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / (max - min || 1)) * (h - 4) - 2}`).join(' ');
  const col = dir === 'down' ? 'var(--color-red)' : dir === 'up' ? 'var(--color-green)' : 'var(--color-steel)';
  return <svg className={className} width={w} height={h}><polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Avatar({ initials, color, size = 26 }: { initials: string; color: string; size?: number }) {
  return <span className="avatar-sm" style={{ background: color, width: size, height: size, fontSize: size * 0.4 }}>{initials}</span>;
}

export function PageHead({ overline, title, desc, actions, crumbs, go }: { overline?: string; title: React.ReactNode; desc?: React.ReactNode; actions?: React.ReactNode; crumbs?: { label: string; to?: string }[]; go?: Go }) {
  return (
    <div className="page-head">
      <div>
        {crumbs && (
          <div className="breadcrumb">
            {crumbs.map((c, i) => (
              <Fragment key={i}>
                {i > 0 && <Icon name="chevR" size={9} />}
                {c.to ? <a onClick={() => go?.(c.to as string)}>{c.label}</a> : <span style={{ color: 'var(--color-navy)', fontWeight: 700 }}>{c.label}</span>}
              </Fragment>
            ))}
          </div>
        )}
        {overline && <div className="overline">{overline}</div>}
        <h1 className="page-title">{title}</h1>
        {desc && <p className="page-desc">{desc}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  );
}

/* ---- Topbar ---- */
export function Topbar({ cost, workspace, operator, onAsk }: { cost: string; workspace?: { name: string; sub: string }; operator?: string; onAsk?: () => void }) {
  const router = useRouter();
  const ws = workspace ?? { name: 'VIN Demo', sub: 'workspace' };
  const opName = operator ? operator.replace(/@.*/, '') : 'operator';
  const opInitials = (opName.split(/[.\s_-]+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join('') || 'OP').toUpperCase();
  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* clear cookie best-effort */ }
    router.replace('/login');
  }
  return (
    <header className="topbar">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand__logo" src="/assets/VIN-light.svg" alt="VIN" />
        <span className="brand__div" />
        <div>
          <div className="brand__product">AI Guided Product</div>
          <div className="brand__sub">Experience Platform</div>
        </div>
      </div>
      {/* Single-tenant workspace — a label, not a switcher (no other workspaces to pick). */}
      <div className="ws-switch">
        <span className="ws-switch__dot">{ws.name[0]?.toUpperCase() ?? 'V'}</span>
        <div>
          <div className="ws-switch__name">{ws.name}</div>
          <div className="ws-switch__role">{ws.sub}</div>
        </div>
      </div>
      <div className="topbar__spacer" />
      <div className="cost-pill" title="Cost of demos run month-to-date (cost_events this month)">
        <span className="cost-pill__label">MTD spend</span>
        <span className="cost-pill__val">${cost}</span>
      </div>
      <button onClick={onAsk} title="Ask VIN — live conversation" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 8, border: 'none', background: '#0861CE', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}><Icon name="chat" size={14} /> Ask VIN</button>
      <div className="avatar" title={operator ?? 'Operator'}>{opInitials}</div>
      <button className="topbar__icon" title="Log out" onClick={logout}><Icon name="logout" size={16} /></button>
    </header>
  );
}

/* ---- Sidebar ---- */
export const NAV = [
  { group: 'Workspace', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard' }] },
  { group: 'Library', items: [
    { id: 'products', label: 'Products', icon: 'product', countable: true },
    { id: 'knowledge', label: 'Knowledge', icon: 'knowledge', countable: true },
    { id: 'graphs', label: 'Demo Graphs', icon: 'graph' },
    { id: 'environments', label: 'Environments', icon: 'environment' },
    { id: 'personas', label: 'Personas', icon: 'persona', countable: true },
  ] },
  { group: 'Pipeline', items: [
    { id: 'chain', label: 'Experience Map', icon: 'dashboard' },
    { id: 'experience', label: 'Outcomes & Committee', icon: 'customers' },
    { id: 'orgchart', label: 'Org Chart', icon: 'persona', countable: true },
    { id: 'journeys', label: 'Journeys', icon: 'sessions' },
    { id: 'customers', label: 'Departments', icon: 'customers', countable: true },
    { id: 'sessions', label: 'Demo Sessions', icon: 'sessions', countable: true },
  ] },
  { group: 'Operations', items: [
    { id: 'safety', label: 'Safety & Modes', icon: 'safety' },
    { id: 'governance', label: 'Governance', icon: 'lock' },
    { id: 'aicontrol', label: 'AI Control', icon: 'settings' },
    { id: 'aihistory', label: 'AI Conversation History', icon: 'sessions' },
    { id: 'evals', label: 'Eval Harness', icon: 'evals' },
    { id: 'costs', label: 'Cost & Economics', icon: 'costs' },
  ] },
] as { group: string; items: { id: string; label: string; icon: string; countable?: boolean }[] }[];

export function Sidebar({ route, go, counts }: { route: string; go: Go; counts?: Record<string, number> }) {
  return (
    <nav className="sidebar scroll">
      {NAV.map((g) => (
        <div className="nav-group" key={g.group}>
          <div className="nav-group__title">{g.group}</div>
          {g.items.map((it) => {
            const n = it.countable ? counts?.[it.id] : undefined; // real, live collection size
            return (
              <button key={it.id} className={`nav-item ${route === it.id ? 'active' : ''}`} onClick={() => go(it.id)}>
                <span className="ico"><Icon name={it.icon} size={17} /></span>
                <span className="nav-label">{it.label}</span>
                {n != null && <span className="nav-count">{n}</span>}
              </button>
            );
          })}
        </div>
      ))}
      <div className="sidebar__foot">
        {/* Modes are per-site (set on each Environment) — link to Safety rather than imply one global default. */}
        <button className="nav-item" onClick={() => go('safety')}>
          <span className="ico"><Icon name="safety" size={17} /></span><span className="nav-label">Safety &amp; Modes</span>
        </button>
        <button className="nav-item" onClick={() => go('settings')}>
          <span className="ico"><Icon name="settings" size={17} /></span><span className="nav-label">Settings</span>
        </button>
      </div>
    </nav>
  );
}

/* ---- Mark-unavailable affordance: a visible, clearly-disabled control with the reason/trigger.
   Used wherever a workflow is deferred (not yet wired) so the UI never implies functionality that
   doesn't exist — per the audit's "if you can see it, it must be real / unavailable / removed" rule. */
export function Unavailable({ label, icon, why, primary, sm }: { label: string; icon?: string; why: string; primary?: boolean; sm?: boolean }) {
  return (
    <button className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}${sm ? ' btn-sm' : ''}`} disabled title={why}
      style={{ opacity: .55, cursor: 'not-allowed' }} aria-disabled>
      {icon && <Icon name={icon} size={sm ? 12 : 13} />} {label} <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', opacity: .8, marginLeft: 4, textTransform: 'uppercase' }}>soon</span>
    </button>
  );
}
