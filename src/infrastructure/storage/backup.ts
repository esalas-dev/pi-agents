import { createHash, randomUUID } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { Clock } from "../../domain/requests.ts";
import { DomainError } from "../../domain/errors.ts";
import type { Lease } from "./lease.ts";

export type BackupReceipt = { path: string; sha256: string; createdAt: number };

async function digest(file: string): Promise<string> { return createHash("sha256").update(await readFile(file)).digest("hex"); }

export async function createBackup(lease: Lease, now: Clock): Promise<BackupReceipt> {
  const parent = `${lease.dbPath}.backups`;
  const directory = path.join(parent, `${now()}-${randomUUID()}`);
  const destination = path.join(directory, "backup.sqlite");
  let source;
  let copied = false;
  try {
    await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700);
    await mkdir(directory, { recursive: false, mode: 0o700 }); await chmod(directory, 0o700);
    source = new DatabaseSync(lease.dbPath, { readOnly: true });
    await backup(source, destination);
    copied = true;
    await chmod(destination, 0o600);
    const check = new DatabaseSync(destination, { readOnly: true });
    try {
      const row = check.prepare("PRAGMA integrity_check").get();
      if (row?.integrity_check !== "ok") throw new Error("integrity");
    } finally { check.close(); }
    const sha256 = await digest(destination);
    return { path: destination, sha256, createdAt: now() };
  } catch (error) {
    throw new DomainError("BACKUP_FAILED", undefined, false, { cause: error instanceof Error ? error.message : "unknown" });
  } finally {
    source?.close();
    if (!copied) { try { await realpath(destination); } catch {} }
  }
}

export async function verifyBackup(receipt: BackupReceipt): Promise<void> {
  try {
    const info = await stat(receipt.path);
    if (!info.isFile() || await digest(receipt.path) !== receipt.sha256) throw new Error("hash");
    const db = new DatabaseSync(receipt.path, { readOnly: true });
    try { if (db.prepare("PRAGMA integrity_check").get()?.integrity_check !== "ok") throw new Error("integrity"); }
    finally { db.close(); }
  } catch { throw new DomainError("BACKUP_FAILED"); }
}
