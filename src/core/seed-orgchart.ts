/**
 * Import the REAL org chart from a BambooHR export into org_people (migration 0024). Idempotent — re-running
 * updates name/supervisor/photo but NEVER touches an operator-assigned job_title/department (curated in the
 * console editor). The export carries names + reporting structure but NO titles, so roles are assigned in-app.
 *
 * CSV path:  env ORGCHART_CSV  ||  ~/Downloads/general_bamboohr_org_chart.csv
 * Org:       env ORGCHART_ORG  ||  "VIN Demo (internal)"  (resolved by name; created if missing)
 * Run:       railway run npm run seed:orgchart
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { db } from './db.js';
import { upsertOrgPersonBySource } from './orgchart.js';

const ACTOR = 'orgchart-import';
const CSV = process.env.ORGCHART_CSV || join(homedir(), 'Downloads', 'general_bamboohr_org_chart.csv');
const ORG = process.env.ORGCHART_ORG || 'VIN Demo (internal)';

function parseLine(line: string): string[] {
  const out: string[] = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === ',') { out.push(cur); cur = ''; } else if (c === '"') { q = true; } else cur += c; } }
  out.push(cur); return out;
}

const raw = readFileSync(CSV, 'utf8');
const lines = raw.split(/\r?\n/).filter((l) => l.trim());
const header = parseLine(lines[0]);
const I = (n: string) => header.findIndex((h) => h.replace(/"/g, '').trim().toLowerCase() === n.toLowerCase());
const iId = I('PersonID'), iName = I('Name'), iSup = I('SupervisorID'), iLoc = I('Location'), iPhoto = I('Photo');
if (iId < 0 || iName < 0) { console.error('CSV missing PersonID/Name columns'); process.exit(1); }

// resolve (or create) the organization that owns this chart
let orgId = (await db().query<{ id: string }>(`SELECT id FROM organizations WHERE lower(name)=lower($1) LIMIT 1`, [ORG])).rows[0]?.id;
if (!orgId) orgId = (await db().query<{ id: string }>(`INSERT INTO organizations (name) VALUES ($1) RETURNING id`, [ORG])).rows[0].id;

let created = 0, updated = 0, skipped = 0;
for (const line of lines.slice(1)) {
  const r = parseLine(line);
  const pid = (r[iId] || '').trim(); const name = (r[iName] || '').trim();
  if (!pid || !name) { skipped++; continue; }
  const res = await upsertOrgPersonBySource(orgId, pid, {
    name,
    supervisorSourceId: iSup >= 0 ? ((r[iSup] || '').trim() || null) : null,
    photoUrl: iPhoto >= 0 ? ((r[iPhoto] || '').trim() || null) : null,
    location: iLoc >= 0 ? ((r[iLoc] || '').trim() || null) : null,
  }, ACTOR);
  if (res === 'created') created++; else updated++;
}

console.log(`\n══ Org chart import (${ORG}) ══`);
console.log(`  source: ${CSV}`);
console.log(`  ${created} created, ${updated} updated, ${skipped} skipped (no id/name)`);
console.log(`  Job titles/roles are NOT imported — assign them in the console Org Chart editor.\n`);
process.exit(0);
