import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlService } from '../src/application/control.ts';
import { DomainError } from '../src/domain/errors.ts';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const job = (id, status = 'queued', extra = {}) => ({ id, ...legacyInput(`tarea ${id}`), status, createdAt: 1000, updatedAt: 1000, notified: false, createdBy: { kind: 'human', id: 'tui' }, ...extra });
const request = (requestId, action, reason) => ({ requestId, action, actor: { kind: 'human', id: 'tui' }, ...(reason === undefined ? {} : { reason }) });

async function codeOf(callback, code) {
  const result = await callback();
  assert.equal(result.success, false);
  assert.equal(result.error.code, code);
}

test('pausa y reanuda un job queued con ordinal y reinserción al final', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(job('job-a'), undefined);
    await fixture.seedJob(job('job-b'), undefined);
    const control = createControlService(fixture.repository, () => 2001);
    const paused = await control.control('job-a', request('control:pause', 'pause'));
    assert.equal(paused.success, true);
    assert.equal(paused.value.status, 'paused');
    assert.equal((await fixture.repository.get('job-a')).status, 'paused');
    assert.deepEqual((await fixture.repository.index()).order, ['job-b']);
    const resumed = await control.control('job-a', request('control:resume', 'resume'));
    assert.equal(resumed.value.status, 'queued');
    assert.deepEqual((await fixture.repository.index()).order, ['job-b', 'job-a']);
  } finally { await fixture.close(); }
});

test('cancela queued y paused de forma terminal, pero pausa activa no soportada', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(job('job-q'), undefined);
    await fixture.seedJob(job('job-p', 'paused'), undefined);
    await fixture.seedJob(job('job-r', 'running', { conversationId: 1, submissionId: 2 }));
    const control = createControlService(fixture.repository, () => 2001);
    assert.equal((await control.control('job-q', request('control:q', 'cancel'))).value.status, 'cancelled');
    assert.equal((await control.control('job-p', request('control:p', 'cancel'))).value.status, 'cancelled');
    await codeOf(() => control.control('job-r', request('control:r', 'pause')), 'PAUSE_ACTIVE_UNSUPPORTED');
    assert.equal((await control.control('job-r', request('control:r-cancel', 'cancel'))).value.status, 'cancelling');
  } finally { await fixture.close(); }
});

test('rechaza solicitudes de control malformadas antes de evaluar autorización', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(job('job-invalid'), undefined);
    const outcome = await createControlService(fixture.repository, () => 2001).control('job-invalid', { requestId: 'bad', action: 'pause' });
    assert.equal(outcome.success, false); assert.equal(outcome.error.code, 'INVALID_REQUEST');
  } finally { await fixture.close(); }
});

test('repite control por requestId sin duplicar efecto y detecta conflicto', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(job('job-replay'), undefined);
    const control = createControlService(fixture.repository, () => 2001);
    const first = await control.control('job-replay', request('control:replay', 'pause'));
    const replay = await control.control('job-replay', request('control:replay', 'pause'));
    assert.equal(first.value.replayed, false);
    assert.equal(replay.value.replayed, true);
    await codeOf(() => control.control('job-replay', request('control:replay', 'resume', 'otro payload')), 'CONTROL_CONFLICT');
  } finally { await fixture.close(); }
});
