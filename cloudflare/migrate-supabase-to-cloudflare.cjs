const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const API = 'https://thecoc-api.phamthaihiep1996.workers.dev';
const source = require('child_process').execFileSync('git', ['show', 'HEAD:src/services/supabaseClient.js'], { encoding: 'utf8' });
const fallback = [...source.matchAll(/\|\|\s*'([^']+)'/g)].map((match) => match[1]);
const supabase = createClient(fallback[0], fallback[1]);
const tables = [
  'stores', 'users', 'inventory_items', 'inventory_logs', 'inventory_tickets',
  'shifts', 'attendance_logs', 'shift_registrations', 'payroll_adjustments',
  'payroll_approvals', 'shift_swaps', 'daily_revenue', 'notifications', 'push_tokens',
];

async function apiQuery(body) {
  const response = await fetch(`${API}/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message || `Worker ${response.status}`);
  return result;
}

async function getAll(table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
  }
}

async function copyBucket(bucket) {
  let files = 0;
  async function walk(prefix = '') {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
    if (error) throw new Error(`${bucket}: ${error.message}`);
    for (const item of data || []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (!item.id) { await walk(path); continue; }
      const { data: file, error: downloadError } = await supabase.storage.from(bucket).download(path);
      if (downloadError) throw new Error(`${bucket}/${path}: ${downloadError.message}`);
      const contentType = file.type || 'application/octet-stream';
      const upload = await fetch(`${API}/storage/${bucket}/${path}`, { method: 'PUT', headers: { 'content-type': contentType }, body: file });
      if (!upload.ok) throw new Error(`${bucket}/${path}: upload ${upload.status}`);
      files += 1;
    }
  }
  await walk();
  return files;
}

(async () => {
  for (const table of tables) {
    const rows = await getAll(table);
    for (let i = 0; i < rows.length; i += 100) await apiQuery({ table, action: 'insert', values: rows.slice(i, i + 100) });
    console.log(JSON.stringify({ table, rows: rows.length }));
  }
  for (const bucket of ['shift_reports', 'attendance-photos']) {
    try { console.log(JSON.stringify({ bucket, files: await copyBucket(bucket) })); }
    catch (error) { console.log(JSON.stringify({ bucket, skipped: error.message })); }
  }
})().catch((error) => { console.error(error.message); process.exit(1); });