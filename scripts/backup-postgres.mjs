import { randomBytes, createCipheriv } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";

const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const backupDirectory = process.env.BACKUP_DIR;
const encodedKey = process.env.BACKUP_ENCRYPTION_KEY;
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

if (!databaseUrl || !backupDirectory || !encodedKey) {
  throw new Error("Set DIRECT_URL (or DATABASE_URL), BACKUP_DIR, and BACKUP_ENCRYPTION_KEY.");
}
if (!Number.isInteger(retentionDays) || retentionDays < 1) {
  throw new Error("BACKUP_RETENTION_DAYS must be a positive whole number.");
}

const key = Buffer.from(encodedKey, "base64");
if (key.length !== 32) {
  throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
}

const database = new URL(databaseUrl);
if (database.protocol !== "postgresql:" && database.protocol !== "postgres:") {
  throw new Error("DIRECT_URL or DATABASE_URL must use the postgresql: protocol.");
}
const databaseName = decodeURIComponent(database.pathname.replace(/^\/+/, ""));
if (!databaseName) throw new Error("The database connection URL must include a database name.");

const outputDirectory = join(backupDirectory, "postgres");
await mkdir(outputDirectory, { recursive: true });
const timestamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const outputPath = join(outputDirectory, `shelf-and-soul-${timestamp}.sql.enc`);
const iv = randomBytes(12);
const header = Buffer.concat([Buffer.from("SSB1"), iv]);
const cipher = createCipheriv("aes-256-gcm", key, iv);
cipher.setAAD(Buffer.from("ShelfAndSoulPostgreSQLBackupV1"));

const dump = spawn(process.env.PG_DUMP_PATH || "pg_dump", [
  "--no-password",
  "--format=plain",
  "--no-owner",
  `--host=${database.hostname}`,
  `--port=${database.port || "5432"}`,
  `--username=${decodeURIComponent(database.username)}`,
  `--dbname=${databaseName}`,
], {
  env: {
    ...process.env,
    PGPASSWORD: decodeURIComponent(database.password),
    PGSSLMODE: process.env.PGSSLMODE || "require",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const dumpExit = new Promise((resolve, reject) => {
  dump.once("error", reject);
  dump.once("close", resolve);
});
dumpExit.catch(() => {});

let stderr = "";
let output;
dump.stderr.setEncoding("utf8");
dump.stderr.on("data", (part) => { stderr += part; });

try {
  output = createWriteStream(outputPath, { flags: "wx" });
  await once(output, "open");
  const writeChunk = (chunk) => new Promise((resolve, reject) => {
    output.write(chunk, (error) => error ? reject(error) : resolve());
  });
  await writeChunk(header);
  for await (const chunk of dump.stdout) {
    const encrypted = cipher.update(chunk);
    if (encrypted.length) await writeChunk(encrypted);
  }
  const exitCode = await dumpExit;
  if (exitCode !== 0) throw new Error(`pg_dump exited with code ${exitCode}: ${stderr.trim()}`);
  await writeChunk(Buffer.concat([cipher.final(), cipher.getAuthTag()]));
  output.end();
  await once(output, "finish");

  const retentionCutoff = Date.now() - retentionDays * 86_400_000;
  for (const entry of await readdir(outputDirectory)) {
    if (!/^shelf-and-soul-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sql\.enc$/.test(entry)) continue;
    const path = join(outputDirectory, entry);
    const metadata = await stat(path);
    if (metadata.isFile() && metadata.mtimeMs < retentionCutoff) await unlink(path);
  }
  console.log(`Encrypted Supabase PostgreSQL backup created: ${outputPath}`);
} catch (error) {
  dump.kill();
  if (output && !output.closed) {
    output.destroy();
    await once(output, "close").catch(() => {});
  }
  await unlink(outputPath).catch(() => {});
  throw error;
}
