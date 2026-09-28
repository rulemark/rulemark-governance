// Run by the smoke test's API server before it migrates and seeds.
import { ensureDatabase } from './database.ts';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set');
await ensureDatabase(url);
