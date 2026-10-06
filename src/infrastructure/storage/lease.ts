import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { DomainError } from "../../domain/errors.ts";

export type Lease = { dbPath: string; token: string; release(): Promise<void> };

type LeaseFile = { token: string; pid: number; createdAt: number; dbPath: string };
const codeOf = (error: unknown) => error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;

async function canonicalDatabase(dbPath: string): Promise<string> {
  const absolute = path.resolve(dbPath);
  await mkdir(path.dirname(absolute), { recursive: true, mode: 0o700 });
  try { if ((await lstat(absolute)).isSymbolicLink()) throw new DomainError("STORAGE_INCONSISTENT"); } catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
  return path.join(await realpath(path.dirname(absolute)), path.basename(absolute));
}

export async function acquireLease(dbPath: string): Promise<Lease> {
  const canonical = await canonicalDatabase(dbPath);
  const lockPath = `${canonical}.lock`;
  try { if ((await lstat(lockPath)).isSymbolicLink()) throw new DomainError("STORAGE_INCONSISTENT"); } catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
  const value: LeaseFile = { token: randomUUID(), pid: process.pid, createdAt: Date.now(), dbPath: canonical };
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify(value));
  } catch (error) {
    if (codeOf(error) === "EEXIST") throw new DomainError("STORAGE_BUSY");
    throw new DomainError("STORAGE_ERROR");
  } finally { await handle?.close(); }
  let released = false;
  return {
    dbPath: canonical, token: value.token,
    async release() {
      if (released) return;
      released = true;
      try {
        const current = JSON.parse(await readFile(lockPath, "utf8")) as LeaseFile;
        if (current.token === value.token) await unlink(lockPath);
      } catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
    },
  };
}
