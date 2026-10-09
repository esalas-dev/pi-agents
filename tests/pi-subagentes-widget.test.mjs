import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleWidth } from '@earendil-works/pi-tui';
import { createSubagentsWidget } from '../src/adapters/pi/subagents-widget.ts';

const page = (items = [], nextCursor) => ({ success: true, value: { items, ...(nextCursor ? { nextCursor } : {}) } });
const job = (id, status, overrides = {}) => ({
  id, status, agent: { name: 'worker', source: 'personal' }, createdAt: 1,
  ...(status === 'running' || status === 'cancelling' ? { startedAt: 1 } : {}),
  queuePosition: status === 'queued' ? 1 : undefined,
  task: 'PRIVATE_TASK_SENTINEL', cwd: '/PRIVATE_CWD_SENTINEL', ...overrides,
});

class FakeTimers {
  now = 10_000;
  nextId = 0;
  tasks = new Map();
  setTimeout = (fn, ms) => this.add(fn, ms, 0);
  clearTimeout = id => this.tasks.delete(id);
  setInterval = (fn, ms) => this.add(fn, ms, ms);
  clearInterval = this.clearTimeout;
  add(fn, delay, interval) { const id = ++this.nextId; this.tasks.set(id, { fn, at: this.now + delay, interval }); return id; }
  async advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.tasks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      const [id, task] = next; this.now = task.at;
      if (task.interval) task.at += task.interval; else this.tasks.delete(id);
      task.fn();
      await flush();
    }
    this.now = end; await flush();
  }
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function setup(responses, options = {}) {
  const timers = new FakeTimers(); const calls = []; const registrations = []; let renders = 0;
  const jobs = { async listJobs(filter) { calls.push(filter); const next = responses.shift(); return typeof next === 'function' ? next(filter) : next; } };
  const ui = { setWidget: (...args) => registrations.push(args) };
  const widget = createSubagentsWidget({ jobs, ui, now: () => timers.now,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    setInterval: timers.setInterval, clearInterval: timers.clearInterval,
    ...options });
  const theme = { fg: (_color, text) => text, bold: text => text, dim: text => text };
  const mount = () => {
    const factory = registrations.findLast(([key, value]) => key === 'pi-durable-subagents' && value)?.[1];
    assert.ok(factory, 'widget mounted');
    return factory({ requestRender: () => { renders++; } }, theme);
  };
  return { widget, timers, calls, registrations, mount, renders: () => renders };
}

const emptyCycle = [page(), page()];

test('consulta activos y cola por separado, prioriza activos y limita cuatro filas', async () => {
  const h = setup([page([job('run1', 'running'), job('run2', 'running'), job('run3', 'cancelling')], 'active-next'), page([job('queue1', 'queued'), job('queue2', 'paused')])]);
  h.widget.start(); await flush();
  assert.deepEqual(h.calls, [
    { statuses: ['running', 'cancelling'], limit: 5 },
    { statuses: ['queued', 'paused'], limit: 5 },
  ]);
  const lines = h.mount().render(80).join('\n');
  assert.match(lines, /run1/); assert.match(lines, /run2/); assert.match(lines, /run3/);
  assert.doesNotMatch(lines, /queue2/); assert.match(lines, /Hay más trabajos/);
  assert.ok(lines.split('\n').length <= 6);
  assert.match(h.mount().render(18).join('\n'), /subagents list/);
  assert.doesNotMatch(lines, /PRIVATE_TASK_SENTINEL|PRIVATE_CWD_SENTINEL/);
  await h.widget.close();
});

test('solo una lectura exitosa vacía retira el widget; un error conserva filas como desactualizadas', async () => {
  const h = setup([page([job('run1', 'running')]), page(), { success: false, error: { message: 'offline' } }, ...emptyCycle]);
  h.widget.start(); await flush(); const component = h.mount();
  await h.timers.advance(1000);
  assert.notEqual(h.registrations.at(-1)[1], undefined, 'el fallo no retira el widget existente');
  assert.match(h.mount().render(80).join('\n'), /Datos desactualizados/);
  await h.timers.advance(1000);
  assert.equal(h.registrations.at(-1)[1], undefined, 'solo la lectura exitosa vacía lo retira');
  await h.widget.close();
  assert.ok(component);
});

test('fallo de la segunda consulta conserva la selección anterior y marca datos desactualizados', async () => {
  const h = setup([page([job('run1', 'running')]), page(), page([job('run2', 'running')]), { success: false, error: { message: 'offline' } }]);
  h.widget.start(); await flush(); const component = h.mount();
  await h.timers.advance(1000);
  const text = component.render(80).join('\n');
  assert.match(text, /run1/); assert.doesNotMatch(text, /run2/); assert.match(text, /Datos desactualizados/);
  await h.widget.close();
});

test('consulta lenta no se solapa y la frescura vence a los cinco segundos', async () => {
  let resolveActive;
  const h = setup([page([job('run1', 'running')]), page(), () => new Promise(resolve => { resolveActive = resolve; }), page()]);
  h.widget.start(); await flush(); const component = h.mount();
  await h.timers.advance(1000);
  await h.timers.advance(5000);
  assert.equal(h.calls.length, 3, 'no se inició una segunda consulta durante la lectura lenta');
  assert.match(component.render(80).join('\n'), /Datos desactualizados/);
  resolveActive(page()); await flush(); await h.widget.close();
});

test('duración parte de startedAt, sanitiza secuencias de terminal y adapta líneas pequeñas', async () => {
  const hostile = '\u001b]8;;https://evil.test\u0007worker\u001b]8;;\u001b\\\n\u0001';
  const h = setup([page([job('long-id-123456', 'running', { startedAt: 8_000, agent: { name: hostile } })]), page()]);
  h.widget.start(); await flush(); const component = h.mount();
  const wide = component.render(80).join('\n');
  assert.match(wide, /2s/); assert.doesNotMatch(wide, /\u001b|PRIVATE_TASK|PRIVATE_CWD/);
  for (const width of [18, 20, 40, 80]) for (const line of component.render(width)) assert.ok(visibleWidth(line) <= width);
  assert.match(component.render(18).join('\n'), /long-id|ejecutándose/);
  await h.widget.close();
});

test('queued y paused son estáticos, la cola no inventa posición y no muta jobs', async () => {
  const queued = Object.freeze(job('queue-id', 'queued', { queuePosition: 2 }));
  const paused = Object.freeze(job('paused-id', 'paused', { queuePosition: undefined }));
  const h = setup([page(), page([queued, paused])]);
  h.widget.start(); await flush(); const component = h.mount();
  const text = component.render(80).join('\n');
  assert.match(text, /en cola/); assert.match(text, /posición 2/); assert.match(text, /pausado/); assert.match(text, /Ⅱ/);
  assert.equal(queued.status, 'queued'); assert.equal(paused.status, 'paused');
  const before = component.render(80).join('\n'); await h.timers.advance(250);
  assert.equal(component.render(80).join('\n'), before, 'queued y paused no animan');
  assert.equal(component.handleInput, undefined); assert.equal(component.wantsKeyRelease, undefined);
  await h.widget.close();
});

test('un único reloj mueve el spinner sin consultar y close limpia callbacks', async () => {
  const running = page([job('run1', 'running')]);
  const h = setup([running, page(), running, page(), ...emptyCycle]);
  h.widget.start(); await flush(); const component = h.mount();
  const frames = [component.render(80)[1][0]];
  for (const [expected, calls] of [['/', 2], ['-', 2], ['\\', 2], ['|', 4]]) {
    await h.timers.advance(250); const frame = component.render(80)[1][0];
    assert.equal(frame, expected); assert.equal(h.calls.length, calls); frames.push(frame);
  }
  assert.deepEqual(frames, ['|', '/', '-', '\\', '|']);
  const renders = h.renders(); await h.widget.close(); await h.timers.advance(1000);
  assert.equal(h.renders(), renders);
  assert.equal(h.registrations.at(-1)[1], undefined);
});

test('renderiza como máximo una vez cada 250 ms cuando coinciden consulta y spinner', async () => {
  const h = setup([page([job('run1', 'running')]), page(), page([job('run1', 'running')]), page()]);
  h.widget.start(); await flush(); h.mount(); await h.timers.advance(1000);
  const renders = h.renders(); await h.timers.advance(250);
  assert.equal(h.renders(), renders + 1);
  await h.widget.close();
});

test('close drena una lectura en curso y no publica callbacks tardíos', async () => {
  let resolveActive;
  const h = setup([page([job('run1', 'running')]), page(), () => new Promise(resolve => { resolveActive = resolve; })]);
  h.widget.start(); await flush(); h.mount(); await h.timers.advance(1000);
  const calls = h.calls.length; const closing = h.widget.close(); resolveActive(page([job('run2', 'running')])); await closing;
  assert.equal(h.calls.length, calls, 'no inicia la consulta de cola tras cerrar');
  assert.equal(h.registrations.at(-1)[1], undefined);
  await h.timers.advance(1000); assert.equal(h.calls.length, calls);
});

test('proyecta herramientas simultáneas por callId con reemplazos y prioridad estable', async () => {
  let publish;
  const h = setup([page([job('run1', 'running')]), page()], { watchJobActivity: async (_id, onUpdate) => {
    publish = onUpdate;
    return { initial: { tools: [{ callId: 'a', name: 'read' }, { callId: 'b', name: 'read' }, { callId: 'c', name: 'bash' }], generation: { attempt: 2 }, compactions: [] }, close: async () => {} };
  } });
  h.widget.start(); await flush(); const component = h.mount();
  assert.match(component.render(100).join('\n'), /herramientas: read, read \+1/);
  publish({ tools: [{ callId: 'b', name: '\u001b]8;;https://evil.test\u0007bash\u001b]8;;\u0007' }], generation: { attempt: 3 }, compactions: [] }); await flush();
  const text = component.render(100).join('\n');
  assert.match(text, /herramientas: bash/); assert.doesNotMatch(text, /read|\+1|\u001b|evil\.test/);
  await h.widget.close();
});

test('muestra retry, deferred y compactación sin inventar progreso', async () => {
  const activities = [
    { tools: [], generation: { attempt: 4, retryAt: 1234 }, compactions: [] },
    { tools: [], generation: { attempt: 5, pollAt: 2345 }, compactions: [] },
    { tools: [], compactions: [{ blocking: true, attempt: 2, retryAt: 3456 }] },
    { tools: [], generation: { attempt: 1 }, compactions: [{ blocking: false, attempt: 1 }] },
  ];
  const h = setup([page(activities.map((_, i) => job(`run${i}`, 'running'))), page()], { watchJobActivity: async (_id, onUpdate) => ({ initial: activities.shift(), close: async () => {} }) });
  h.widget.start(); await flush();
  const text = h.mount().render(120).join('\n');
  assert.match(text, /esperando reintento/); assert.match(text, /esperando proveedor/); assert.match(text, /compactando contexto/); assert.match(text, /generando respuesta/);
  assert.doesNotMatch(text, /1234|2345|3456|%|PRIVATE_/);
  await h.widget.close();
});

test('observador ausente degrada solo actividad y vuelve a intentarse en la siguiente consulta', async () => {
  let acquisitions = 0;
  const h = setup([page([job('run1', 'running')]), page(), page([job('run1', 'running')]), page()], { watchJobActivity: async () => {
    acquisitions++;
    return acquisitions === 1 ? undefined : { initial: { tools: [], generation: { attempt: 1 }, compactions: [] }, close: async () => {} };
  } });
  h.widget.start(); await flush();
  assert.match(h.mount().render(100).join('\n'), /actividad no disponible/);
  await h.timers.advance(1000);
  assert.equal(acquisitions, 2);
  assert.match(h.mount().render(100).join('\n'), /generando respuesta/);
  assert.equal(h.calls.length, 4);
  await h.widget.close();
});

test('observador cerrado inesperadamente degrada actividad y se recupera en siguiente consulta', async () => {
  let end; let acquisitions = 0;
  const h = setup([page([job('run1', 'running')]), page(), page([job('run1', 'running')]), page()], { watchJobActivity: async () => {
    acquisitions++;
    const closed = new Promise(resolve => { end = resolve; });
    return { initial: { tools: [], generation: { attempt: acquisitions }, compactions: [] }, closed, close: async () => { end(); } };
  } });
  h.widget.start(); await flush(); const component = h.mount();
  assert.match(component.render(100).join('\n'), /generando respuesta/);
  end(); await flush();
  assert.match(component.render(100).join('\n'), /actividad no disponible/);
  await h.timers.advance(1000);
  assert.equal(acquisitions, 2);
  assert.match(component.render(100).join('\n'), /generando respuesta/);
  await h.widget.close();
});

test('terminal durable prevalece sobre callbacks tardíos y cierra el observador', async () => {
  let publish; let closes = 0;
  const h = setup([page([job('run1', 'running')]), page(), ...emptyCycle], { watchJobActivity: async (_id, onUpdate) => {
    publish = onUpdate;
    return { initial: { tools: [], generation: { attempt: 1 }, compactions: [] }, close: async () => { closes++; } };
  } });
  h.widget.start(); await flush(); h.mount();
  await h.timers.advance(1000);
  assert.equal(h.registrations.at(-1)[1], undefined);
  publish({ tools: [{ callId: 'late', name: 'bash' }], compactions: [] }); await flush();
  assert.equal(h.registrations.at(-1)[1], undefined); assert.equal(closes, 1);
  await h.widget.close();
});

test('limita a cuatro observadores y cierra los retirados; spinner no crea watches', async () => {
  const active = page(Array.from({ length: 5 }, (_, i) => job(`run${i}`, 'running')));
  const watches = []; let closes = 0;
  const h = setup([active, page(), ...emptyCycle], { watchJobActivity: async id => {
    watches.push(id);
    return { initial: { tools: [], generation: { attempt: 1 }, compactions: [] }, close: async () => { closes++; } };
  } });
  h.widget.start(); await flush(); h.mount();
  assert.equal(watches.length, 4);
  await h.timers.advance(250);
  assert.equal(watches.length, 4); assert.equal(h.calls.length, 2);
  await h.timers.advance(750);
  assert.equal(closes, 4);
  await h.widget.close();
});

test('movimiento reducido conserva refresco y estado estático', async () => {
  const previous = process.env.PI_AGENTS_ANIMATION;
  process.env.PI_AGENTS_ANIMATION = '0';
  try {
    let watches = 0;
    const h = setup([page([job('run1', 'running')]), page(), ...emptyCycle], { watchJobActivity: async () => { watches++; return { initial: { tools: [], generation: { attempt: 1 }, compactions: [] }, close: async () => {} }; } });
    h.widget.start(); await flush(); const component = h.mount(); const before = component.render(80).join('\n');
    await h.timers.advance(250);
    assert.equal(component.render(80)[1].slice(0, 2), before.split('\n')[1].slice(0, 2)); assert.match(component.render(80).join('\n'), /generando respuesta/); assert.equal(h.calls.length, 2); assert.equal(watches, 1);
    await h.timers.advance(750); assert.equal(h.calls.length, 4);
    await h.widget.close();
  } finally {
    if (previous === undefined) delete process.env.PI_AGENTS_ANIMATION; else process.env.PI_AGENTS_ANIMATION = previous;
  }
});
