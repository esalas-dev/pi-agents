import { acquireLease } from '../../src/infrastructure/storage/lease.ts';
import { writeFile } from 'node:fs/promises';

const database = process.argv[2];
const barrier = process.argv[3] ?? 'lease-acquired';
const lease = await acquireLease(database);
await writeFile(`${database}.${barrier}`, String(process.pid), { flag: 'wx' });
process.stdin.resume();
