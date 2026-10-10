import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlService } from '../src/application/control.ts';
import { JobControlDocFamily } from '../src/infrastructure/durable/documents.ts';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { makeStoreFixture } from './helpers/store.mjs';
import { legacyInput } from './helpers/legacy.mjs';

const queuedJob = (id, createdBy = { kind: 'human', id: 'tui' }, overrides = {}) => ({
  id, ...legacyInput(`task-${id}`), status: 'queued', createdAt: 1000, updatedAt: 1000,
  notified: false, createdBy, ...overrides,
});
const request = (requestId, actor = { kind: 'human', id: 'tui' }) => ({
  requestId, action: 'cancel', actor,
});
const admission = (confirmed) => ({ requireActiveConfirmation: true, activeCancellationConfirmed: confirmed });

async function requestCell(fixture, requestId) {
  return fixture.repository.receipt(requestId);
}


test('cancelar queued sin consentimiento no muta estado, ledger ni eventos', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(queuedJob('queued-no-consent'));
    const control = createControlService(fixture.repository, () => 2001);
    const outcome = await control.control('queued-no-consent', request('cancel:no-consent'), admission(false));
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'ACTIVE_CANCEL_CONFIRMATION_REQUIRED');
    assert.equal((await fixture.repository.get('queued-no-consent')).status, 'queued');
    assert.equal(await requestCell(fixture, 'cancel:no-consent'), undefined);
    const history = await fixture.session.snapshot(JobControlDocFamily, 'queued-no-consent', BACKGROUND_CONTEXT);
    assert.equal(history, undefined);
  } finally { await fixture.close(); }
});

test('la carrera queued a running se rechaza en la aplicación transaccional sin intención cancel', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(queuedJob('race'));
    let raced = false;
    const repository = new Proxy(fixture.repository, {
      get(target, property, receiver) {
        if (property === 'get') return async id => {
          const value = await target.get(id);
          if (!raced) {
            raced = true;
            await target.claimNext(1, async () => 7);
            await target.markRunning(id, 8, 2002);
          }
          return value;
        };
        return Reflect.get(target, property, receiver);
      },
    });
    const control = createControlService(repository, () => 2003);
    const outcome = await control.control('race', request('cancel:race'), admission(false));
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'ACTIVE_CANCEL_CONFIRMATION_REQUIRED');
    assert.equal((await fixture.repository.get('race')).status, 'running');
    assert.equal(await requestCell(fixture, 'cancel:race'), undefined);
    const history = await fixture.session.snapshot(JobControlDocFamily, 'race', BACKGROUND_CONTEXT);
    assert.equal(history, undefined);
  } finally { await fixture.close(); }
});

test('consentimiento admite una intención y su replay no solicita consentimiento nuevo', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(queuedJob('replay'));
    const control = createControlService(fixture.repository, () => 2001);
    const first = await control.control('replay', request('cancel:replay'), admission(true));
    assert.equal(first.success, true);
    assert.equal(first.value.replayed, false);
    const replay = await control.control('replay', request('cancel:replay'), admission(false));
    assert.equal(replay.success, true);
    assert.equal(replay.value.replayed, true);
    const history = await fixture.session.snapshot(JobControlDocFamily, 'replay', BACKGROUND_CONTEXT);
    assert.equal(history.events.length, 1);
  } finally { await fixture.close(); }
});

test('model o extension de otro propietario no reciben recibo de control', async () => {
  const fixture = await makeStoreFixture({ createId: () => 'unused' });
  try {
    await fixture.seedJob(queuedJob('owned', { kind: 'model', id: 'owner-a' }));
    const control = createControlService(fixture.repository, () => 2001);
    const outcome = await control.control('owned', request('cancel:other', { kind: 'model', id: 'owner-b' }), admission(true));
    assert.equal(outcome.success, false);
    assert.equal(outcome.error.code, 'CONTROL_NOT_AUTHORIZED');
    assert.equal(await requestCell(fixture, 'cancel:other'), undefined);
  } finally { await fixture.close(); }
});
