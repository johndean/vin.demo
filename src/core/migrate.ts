/** Apply SQL migrations via pg (no psql needed). Run: npm run migrate */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { db } from './db.js';

const file = path.resolve('db/migrations/0001_entity_model.sql');
const sql = await readFile(file, 'utf8');
await db().query(sql); // simple query protocol runs multiple statements
console.log(`Applied ${path.basename(file)}`);
process.exit(0);
