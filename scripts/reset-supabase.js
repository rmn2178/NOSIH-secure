/**
 * Reset the Supabase database to a fresh NOSIH install.
 *
 *   node scripts/reset-supabase.js --dry-run   # show what would be dropped
 *   node scripts/reset-supabase.js             # drop everything + re-apply schema.sql
 *
 * Drops every table in the public schema, then re-applies
 * backend/supabase/schema.sql so the database starts truly empty.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DRY_RUN = process.argv.includes("--dry-run");

function readEnvFile(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (/^".*"$|^'.*'$/.test(v)) v = v.slice(1, -1);
    values[m[1]] = v;
  }
  return values;
}

(async () => {
  const env = readEnvFile(path.join(ROOT, ".env"));
  const url = env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL missing from the root .env");
    process.exit(1);
  }

  let pg;
  try {
    pg = require(path.join(ROOT, "backend", "node_modules", "pg"));
  } catch {
    console.error("pg not installed. Run: cd backend && npm install pg --no-save");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log("Connected to Supabase Postgres\n");

  // ── Snapshot what exists ─────────────────────────────────
  const { rows: tables } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);

  console.log("Current public schema:");
  if (!tables.length) console.log("  (no tables)");
  for (const t of tables) {
    const { rows } = await client.query(`select count(*)::int as n from public."${t.table_name}"`);
    const { rows: cols } = await client.query(
      `select count(*)::int as n from information_schema.columns
       where table_schema='public' and table_name=$1`,
      [t.table_name]
    );
    console.log(`  ${t.table_name.padEnd(20)} rows=${String(rows[0].n).padStart(5)}  cols=${cols[0].n}`);
  }

  const { rows: funcs } = await client.query(`
    select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  `);
  if (funcs.length) console.log(`  functions: ${funcs.map((f) => f.proname).join(", ")}`);

  if (DRY_RUN) {
    console.log("\n--dry-run: nothing was changed.");
    await client.end();
    return;
  }

  if (!tables.length) {
    console.log("\nNothing to drop — applying schema only.");
  } else {
    console.log("\nDropping tables (cascade) …");
    // Table-level drops keep the public schema's grants, ownership and the
    // supabase_realtime publication intact — safer than dropping the schema.
    for (const t of tables) {
      await client.query(`drop table if exists public."${t.table_name}" cascade;`);
      console.log(`  dropped ${t.table_name}`);
    }
    await client.query("drop function if exists public.set_updated_at() cascade;");
    console.log("  dropped function set_updated_at");
    const { rows: seqs } = await client.query(`
      select sequence_name from information_schema.sequences
      where sequence_schema = 'public'
    `);
    for (const s of seqs) {
      await client.query(`drop sequence if exists public."${s.sequence_name}" cascade;`);
      console.log(`  dropped sequence ${s.sequence_name}`);
    }
  }

  // ── Re-apply schema ──────────────────────────────────────
  const schemaPath = path.join(ROOT, "backend", "supabase", "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  console.log(`\nApplying ${path.relative(ROOT, schemaPath)} …`);
  await client.query(schema);
  console.log("  schema applied");

  // ── Verify ───────────────────────────────────────────────
  const { rows: after } = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  console.log("\nAfter reset:");
  for (const t of after) {
    const { rows } = await client.query(`select count(*)::int as n from public."${t.table_name}"`);
    console.log(`  ${t.table_name.padEnd(20)} rows=${rows[0].n}`);
  }

  await client.end();
  console.log("\n✓ Database reset complete — fresh, empty, schema applied.");
})().catch((e) => {
  console.error("Reset failed:", e.message);
  process.exit(1);
});
