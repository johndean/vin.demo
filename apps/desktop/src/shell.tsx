/* Control-room shared primitives. The Icon renders a bare <svg> + <path>; fill/stroke
   are governed by control-room.css (.cr svg / .cr svg.solid), and callers pass the
   `solid` class where a filled glyph is wanted — matching the design 1:1. */
import React from 'react';

export const ICONS: Record<string, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 14h7v7H3z',
  knowledge: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5z',
  customers: 'M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 5V3a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18',
  sessions: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM10 8l6 4-6 4z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.4H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9.3A1.6 1.6 0 0 0 10.3 3V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9.3a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  chevR: 'M9 18l6-6-6-6',
  lock: 'M5 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 9V7a4 4 0 0 1 8 0v2',
  lockOpen: 'M5 11a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2zM8 9V7a4 4 0 0 1 7-2.6',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  x: 'M18 6 6 18M6 6l12 12',
  play: 'M5 3l14 9-14 9z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  step: 'M5 4l10 8-10 8zM19 5v14',
  restart: 'M1 4v6h6M3.5 9a9 9 0 1 1-1.3 5',
  stop: 'M5 5h14v14H5z',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
  spark: 'M12 2l2.4 7.2H22l-6 4.4 2.3 7.2-6.3-4.5L5.7 21 8 13.6 2 9.2h7.6z',
  check: 'M20 6 9 17l-5-5',
  dot: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
};

export function Icon({ name, size = 16, className, style }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) {
  const d = ICONS[name] || ICONS.dot;
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" style={style}><path d={d} /></svg>;
}

export const MODE_META: Record<string, { cls: string; icon: string; label: string }> = {
  'read-only': { cls: 'readonly', icon: 'eye', label: 'Read-only' },
  safe: { cls: 'safe', icon: 'check', label: 'Safe' },
  approval: { cls: 'approval', icon: 'lockOpen', label: 'Approval' },
  execution: { cls: 'execution', icon: 'lock', label: 'Execution' },
};

export const VALIDATION: Record<string, { kind: string; label: string }> = {
  validated: { kind: 'success', label: 'Validated' },
  'needs-review': { kind: 'warn', label: 'Needs review' },
  stale: { kind: 'danger', label: 'Stale' },
};
