import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { acquireLease } from '../src/infrastructure/storage/lease.ts';

const workerPath = new URL('./helpers/crash-worker.mjs', import.meta.url).pathname;
const waitFor = async file => { const deadline = Date.now() + 5000; while (Date.now() < deadline) { try { await access(file); return; } catch {} await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error(`timeout: ${file}`); };
export async function spawnCrashWorker({ database, scenario = 'lease-acquired' }) {
  const child = spawn(process.execPath, [workerPath, database, scenario], { stdio: ['pipe', 'ignore', 'pipe'] });
  const barrier = `${database}.${scenario}`; await waitFor(barrier);
  return { async waitForBarrier(name) { await waitFor(`${database}.${name}`); }, async kill() { child.kill('SIGKILL'); await new Promise(resolve => child.once('exit', resolve)); }, async close() { child.stdin.end(); await new Promise(resolve => child.once('exit', resolve)); } };
}
async function removeVerifiedDeadTestLock(database, childDead = true) { assert.equal(childDead, true); const lock = `${database}.lock`; const record = JSON.parse(await readFile(lock, 'utf8')); assert.ok(Number.isInteger(record.pid)); await rm(lock); }
const hasCode = code => error => error?.error?.code === code;

test('SIGKILL deja lock observable y solo se retira tras confirmar muerte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-agents-crash-')); const database = join(directory, 'jobs.sqlite');
  try { const worker = await spawnCrashWorker({ database, scenario: 'lease-acquired' }); await assert.rejects(acquireLease(database), hasCode('STORAGE_BUSY')); await worker.kill(); await removeVerifiedDeadTestLock(database); const lease = await acquireLease(database); await lease.release(); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
