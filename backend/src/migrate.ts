import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
// In local dev, supabase/migrations lives at the repo root (one level up from backend/).
// In the Docker image, it's copied in alongside backend/ itself (see Dockerfile), so both
// locations are checked.
const candidateDirs = [
  path.join(backendRoot, "supabase", "migrations"),
  path.join(backendRoot, "..", "supabase", "migrations"),
];
const migrationsDir = candidateDirs.find((d) => fs.existsSync(d));
if (!migrationsDir) {
  throw new Error(`Could not find supabase/migrations in any of: ${candidateDirs.join(", ")}`);
}

async function run() {
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  console.log("[migrate] applying bootstrap.sql");
  await client.query(fs.readFileSync(path.join(backendRoot, "sql", "bootstrap.sql"), "utf8"));

  await client.query(`
    CREATE TABLE IF NOT EXISTS public._backend_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const { rows: appliedRows } = await client.query<{ filename: string }>("SELECT filename FROM public._backend_migrations");
  const applied = new Set(appliedRows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`[migrate] applying ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO public._backend_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[migrate] FAILED on ${file}:`, err);
      throw err;
    }
  }

  console.log("[migrate] applying post-migrate.sql");
  await client.query(fs.readFileSync(path.join(backendRoot, "sql", "post-migrate.sql"), "utf8"));

  await client.end();
  console.log(`[migrate] done. ${files.length} migration file(s) checked, ${files.length - applied.size} newly applied.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
