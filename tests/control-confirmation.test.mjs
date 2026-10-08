import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlService } from '../src/application/control.ts';
import { JobControlDocFamily, RequestLedgerDocFamily } from '../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const job = (id, status = 'queued', extra = {}) => ({
  id, ...legacyInput(`tarea ${id}`), status, createdAt: 1000, updatedAt: 1000, notified: false,
  createdBy: { kind: 'human', id: 'tui' }, ...extra,
});
const cancel = (requestId, actor = { kind: 'human', id: 'tui' }) => ({ requestId, action: 'cancel', actor });
const admission = { requireActiveConfirmation: true, activeCancellationConfirmed: false };
test('cancelar queued con confirmación activa ausente no muta job, ledger ni eventos', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('queued-cancel'));
    const outcome = await createControlService(fixture.repository, () => 2001).control('queued-cancel', cancel('cancel-no-confirm'), admission);
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'ACTIVE_CANCEL_CONFIRMATION_REQUIRED');
    assert.equal((await fixture.repository.get('queued-cancel')).status, 'queued');
    assert.equal(await fixture.repository.receipt('cancel-no-confirm'), undefined);
    assert.equal((await fixture.session.snapshot(JobControlDocFamily, 'queued-cancel', BACKGROUND_CONTEXT)), undefined);
    assert.deepEqual(await fixture.outbox.pending(10), []);
  } finally { await fixture.close(); }
});

test('la carrera queued a running rechaza cancelación no confirmada sin intención', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('race-cancel'));
    let firstRead = true;
    const repository = {
      ...fixture.repository,
      get: async id => {
        const current = await fixture.repository.get(id);
        if (firstRead) {
          firstRead = false;
          await fixture.repository.claimNext(1, async () => 7);
          await fixture.repository.markRunning(id, 8, 2002);
        }
        return current;
      },
    };
    const outcome = await createControlService(repository, () => 2003).control('race-cancel', cancel('cancel-race'), admission);
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'ACTIVE_CANCEL_CONFIRMATION_REQUIRED');
    assert.equal((await fixture.repository.get('race-cancel')).status, 'running');
    assert.equal(await fixture.repository.receipt('cancel-race'), undefined);
    assert.equal((await fixture.session.snapshot(JobControlDocFamily, 'race-cancel', BACKGROUND_CONTEXT)), undefined);
    assert.deepEqual((await fixture.outbox.pending(10)).map(event => event.type), ['job.provisioning', 'job.started']);
  } finally { await fixture.close(); }
});

test('tras consentimiento cancelación crea intención y su replay no requiere otro consentimiento', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('confirmed-cancel'));
    const control = createControlService(fixture.repository, () => 2001);
    const request = cancel('cancel-confirmed');
    const first = await control.control('confirmed-cancel', request, { requireActiveConfirmation: true, activeCancellationConfirmed: true });
    assert.equal(first.success, true);
    assert.equal(first.value.status, 'cancelled');
    const replay = await control.control('confirmed-cancel', request, admission);
    assert.equal(replay.success, true);
    assert.equal(replay.value.replayed, true);
    assert.equal((await fixture.repository.consumption('confirmed-cancel')), undefined);
    assert.equal((await fixture.outbox.pending(10)).length, 1);
  } finally { await fixture.close(); }
});

test('actor model o extension de otro propietario no recibe recibo de control', async () => {
  const fixture = await makeStoreFixture();
  try {
    await fixture.seedJob(job('owned', 'queued', { createdBy: { kind: 'model', id: 'owner' } }));
    for (const actor of [{ kind: 'model', id: 'other' }, { kind: 'extension', id: 'other' }]) {
      const outcome = await createControlService(fixture.repository, () => 2001).control('owned', { requestId: `control-${actor.kind}`, action: 'pause', actor });
      assert.equal(outcome.success, false);
      assert.equal(outcome.error.code, 'CONTROL_NOT_AUTHORIZED');
      assert.equal(await fixture.repository.receipt(`control-${actor.kind}`), undefined);
    }
  } finally { await fixture.close(); }
});
