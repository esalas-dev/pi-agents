import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { JobsService } from "../../application/jobs.ts";
import type { JobListView } from "../../domain/jobs.ts";
import type { JobActivity } from "../../runtime/session.ts";

const KEY = "pi-durable-subagents";
const ACTIVE = ["running", "cancelling"] as const;
const QUEUED = ["queued", "paused"] as const;
const FRAMES = ["|", "/", "-", "\\"];
const clean = (value: string) => stripTerminalSequences(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
const LABELS: Partial<Record<JobListView["status"], string>> = { running: "ejecutándose", cancelling: "cancelando", queued: "en cola", paused: "pausado" };
const statusLabel = (status: JobListView["status"]) => LABELS[status] ?? status;
const duration = (startedAt: number | undefined, now: number) => startedAt === undefined ? "—" : `${Math.floor(Math.max(0, now - startedAt) / 1000)}s`;

type Row = Pick<JobListView, "id" | "status" | "startedAt" | "queuePosition"> & { agent: string; activity?: JobActivity; activityUnavailable?: boolean };
type ActivityWatch = { initial: JobActivity; closed?: Promise<unknown>; close(): Promise<void> };
type ActivityEntry = { pending: boolean; retiring?: boolean; work?: Promise<void>; watch?: ActivityWatch; latest?: JobActivity };
type Page = { items: readonly JobListView[]; nextCursor?: string };
type WidgetUi = Pick<ExtensionContext["ui"], "setWidget">;
type Options = {
  jobs: Pick<JobsService, "listJobs">;
  ui: WidgetUi;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
  watchJobActivity?: (jobId: string, onUpdate: (activity: JobActivity) => void) => Promise<ActivityWatch | undefined>;
};

function selectRows(active: Page, queued: Page): { rows: Row[]; more: boolean } {
  const candidates = [...active.items, ...queued.items];
  return {
    rows: candidates.slice(0, 4).map(item => ({ id: clean(item.id), agent: clean(item.agent.name), status: item.status, startedAt: item.startedAt, queuePosition: item.queuePosition })),
    more: candidates.length > 4 || Boolean(active.nextCursor || queued.nextCursor),
  };
}

function activityLabel(row: Row): string {
  if (row.activityUnavailable) return "actividad no disponible";
  if (!row.activity) return "actividad aún no disponible";
  if (row.activity.tools.length) {
    const names = row.activity.tools.map(tool => clean(tool.name)).filter(Boolean);
    return names.length ? `herramientas: ${names.slice(0, 2).join(", ")}${names.length > 2 ? ` +${names.length - 2}` : ""}` : "herramienta activa";
  }
  if (row.activity.generation?.retryAt !== undefined) return `esperando reintento · intento ${row.activity.generation.attempt}`;
  if (row.activity.generation?.pollAt !== undefined) return `esperando proveedor · intento ${row.activity.generation.attempt}`;
  if (row.activity.compactions.some(compaction => compaction.blocking)) return "compactando contexto";
  if (row.activity.generation) return `generando respuesta · intento ${row.activity.generation.attempt}`;
  if (row.activity.compactions.length) return "compactación en segundo plano";
  return "sin actividad observable";
}

function shortIds(rows: Row[]): string[] {
  return rows.map((row, index) => {
    const id = row.id;
    let length = Math.min(8, id.length);
    while (rows.some((other, otherIndex) => otherIndex !== index && other.id.slice(0, length) === id.slice(0, length)) && length < id.length) length++;
    return id.slice(0, length);
  });
}

export function createSubagentsWidget(options: Options): { start(): void; close(): Promise<void> } {
  const now = options.now ?? Date.now;
  const schedule = options.setTimeout ?? setTimeout;
  const unschedule = options.clearTimeout ?? clearTimeout;
  const repeat = options.setInterval ?? setInterval;
  const stopRepeating = options.clearInterval ?? clearInterval;
  const animate = process.env.PI_AGENTS_ANIMATION !== "0";
  let started = false;
  let closed = false;
  let mounted = false;
  let hasSnapshot = false;
  let stale = false;
  let more = false;
  let rows: Row[] = [];
  let frame = 0;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let animationTimer: ReturnType<typeof setInterval> | undefined;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let lastRenderAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let component: Component | undefined;
  let requestRender: (() => void) | undefined;
  const activityWatches = new Map<string, ActivityEntry>();

  const flushRender = () => {
    renderTimer = undefined;
    if (closed || !mounted || !component || !requestRender) return;
    const wait = 250 - (now() - lastRenderAt);
    if (wait > 0) { renderTimer = schedule(flushRender, wait); return; }
    lastRenderAt = now(); requestRender();
  };
  const update = () => {
    if (!component || !requestRender) return;
    component.invalidate();
    const wait = 250 - (now() - lastRenderAt);
    if (wait <= 0) { lastRenderAt = now(); requestRender(); }
    else if (renderTimer === undefined) renderTimer = schedule(flushRender, wait);
  };
  const stopAnimation = () => { if (animationTimer !== undefined) stopRepeating(animationTimer); animationTimer = undefined; };
  const activeVisible = () => rows.some(row => ACTIVE.includes(row.status as typeof ACTIVE[number]));
  const syncAnimation = () => {
    if (!animate || !mounted || stale || !activeVisible()) { stopAnimation(); return; }
    if (animationTimer === undefined) animationTimer = repeat(() => { frame = (frame + 1) % FRAMES.length; update(); }, 250);
  };
  const unmount = () => {
    if (!mounted) return;
    mounted = false; stopAnimation();
    if (renderTimer !== undefined) unschedule(renderTimer);
    renderTimer = undefined; component = undefined; requestRender = undefined;
    options.ui.setWidget(KEY, undefined);
  };
  const mount = () => {
    if (mounted || closed) return;
    mounted = true;
    options.ui.setWidget(KEY, (tui, theme) => {
      const instance: Component & { dispose(): void } = {
        render(width) {
          if (width <= 0) return [];
          if (rows.length === 0) return hasSnapshot ? [] : [truncateToWidth(theme.fg("accent", "Estado no disponible"), width)];
          const ids = shortIds(rows);
          const cramped = rows.some((row, index) => visibleWidth(`${ids[index]} ${statusLabel(row.status)}`) + 2 > width);
          if (width < 20 || cramped) {
            const first = rows[0];
            const icon = ACTIVE.includes(first.status as typeof ACTIVE[number]) ? FRAMES[frame] : first.status === "paused" ? "Ⅱ" : "○";
            const summary = more || cramped || rows.length > 1 ? `${icon} /subagents list` : `${icon} ${ids[0]} ${statusLabel(first.status)}`;
            return [truncateToWidth(theme.fg("accent", `${summary}${stale ? " · desactualizados" : ""}`), width)];
          }
          const heading = `Subagentes · ${rows.length} visibles`;
          const warning = [stale ? "Datos desactualizados" : "", more ? "Hay más trabajos: /subagents list" : ""].filter(Boolean).join(" · ");
          const lines = [truncateToWidth(theme.fg("accent", theme.bold(heading)), width)];
          rows.forEach((row, index) => {
            const active = ACTIVE.includes(row.status as typeof ACTIVE[number]);
            const icon = active ? FRAMES[frame] : row.status === "paused" ? "Ⅱ" : "○";
            const label = statusLabel(row.status);
            const elapsed = active ? duration(row.startedAt, now()) : row.queuePosition === undefined ? "—" : `posición ${row.queuePosition}`;
            const prefix = `${icon} ${ids[index]} ${label}`;
            const detail = `${prefix} ${row.agent}${elapsed === "—" ? "" : ` · ${elapsed}`}${options.watchJobActivity ? ` · ${activityLabel(row)}` : ""}`;
            lines.push(truncateToWidth(width < 36 ? prefix : detail, width));
          });
          if (warning) lines.push(truncateToWidth(theme.fg("accent", warning), width));
          return lines.slice(0, 6);
        },
        invalidate() {},
        dispose() { if (component === instance) { component = undefined; requestRender = undefined; } },
      };
      component = instance;
      requestRender = () => tui.requestRender();
      return instance;
    }, { placement: "aboveEditor" });
    syncAnimation();
  };

  const setActivity = (id: string, activity: JobActivity | undefined, unavailable = false) => {
    const row = rows.find(candidate => candidate.id === id && ACTIVE.includes(candidate.status as typeof ACTIVE[number]));
    if (!row) return;
    rows = rows.map(candidate => candidate === row ? { ...candidate, activity, activityUnavailable: unavailable } : candidate);
    update();
  };
  const closeActivity = async () => {
    const watches = [...activityWatches.values()]; activityWatches.clear();
    await Promise.allSettled(watches.map(async entry => {
      await entry.work?.catch(() => {});
      await entry.watch?.close();
    }));
  };
  const reconcileActivity = (selectedRows: Row[]) => {
    const observe = options.watchJobActivity;
    if (!observe) return;
    const activeIds = new Set(selectedRows.filter(row => ACTIVE.includes(row.status as typeof ACTIVE[number])).map(row => row.id));
    for (const [id, entry] of activityWatches) {
      if (activeIds.has(id) || entry.pending || entry.retiring) continue;
      const watch = entry.watch;
      if (!watch) { activityWatches.delete(id); continue; }
      entry.retiring = true;
      entry.work = (async () => {
        await watch.close();
        entry.watch = undefined;
        if (activityWatches.get(id) === entry) activityWatches.delete(id);
      })().catch(() => {});
    }
    for (const id of activeIds) {
      const existing = activityWatches.get(id);
      if (existing?.watch || existing?.pending || existing?.retiring) continue;
      // Las adquisiciones y cierres pendientes también reservan un slot.
      if (!existing && activityWatches.size >= 4) break;
      const entry: ActivityEntry = { pending: true };
      activityWatches.set(id, entry);
      setActivity(id, undefined);
      entry.work = (async () => {
        try {
          const watch = await observe(id, activity => {
            if (!closed && !entry.retiring && activityWatches.get(id) === entry) { entry.latest = activity; setActivity(id, activity); }
          });
          entry.watch = watch;
          if (closed || activityWatches.get(id) !== entry || !rows.some(row => row.id === id && ACTIVE.includes(row.status as typeof ACTIVE[number]))) {
            entry.retiring = true;
            await watch?.close();
            entry.watch = undefined;
            if (activityWatches.get(id) === entry) activityWatches.delete(id);
            return;
          }
          if (!watch) { setActivity(id, undefined, true); return; }
          setActivity(id, entry.latest ?? watch.initial);
          void watch.closed?.then(() => {
            if (closed || entry.retiring || activityWatches.get(id) !== entry || entry.watch !== watch) return;
            entry.watch = undefined; setActivity(id, undefined, true);
          }).catch(() => {
            if (!closed && !entry.retiring && activityWatches.get(id) === entry && entry.watch === watch) { entry.watch = undefined; setActivity(id, undefined, true); }
          });
        } catch {
          if (!entry.retiring && activityWatches.get(id) === entry) setActivity(id, undefined, true);
        } finally { entry.pending = false; }
      })();
    }
  };
  const fail = () => {
    if (closed) return;
    stale = rows.length > 0;
    if (!hasSnapshot) mount();
    syncAnimation(); update();
  };
  const refresh = async () => {
    if (closed || inFlight) return;
    const work = (async () => {
      staleTimer = schedule(() => { staleTimer = undefined; fail(); }, 5000);
      try {
        const active = await options.jobs.listJobs({ statuses: [...ACTIVE], limit: 5 });
        if (closed) return;
        if (!active.success) { fail(); return; }
        const queued = await options.jobs.listJobs({ statuses: [...QUEUED], limit: 5 });
        if (closed) return;
        if (!queued.success) { fail(); return; }
        hasSnapshot = true;
        const selected = selectRows(active.value, queued.value);
        const previous = new Map(rows.map(row => [row.id, row]));
        rows = selected.rows.map(row => ({ ...row, activity: previous.get(row.id)?.activity, activityUnavailable: previous.get(row.id)?.activityUnavailable }));
        more = selected.more; stale = false;
        if (rows.length) mount(); else unmount();
        syncAnimation(); update();
        reconcileActivity(rows);
      } catch { fail(); }
      finally {
        if (staleTimer !== undefined) unschedule(staleTimer);
        staleTimer = undefined;
      }
    })();
    inFlight = work;
    await work;
    if (inFlight === work) inFlight = undefined;
    if (!closed && started) refreshTimer = schedule(() => { refreshTimer = undefined; void refresh(); }, 1000);
  };

  return {
    start() { if (started || closed) return; started = true; void refresh(); },
    close() {
      if (closePromise) return closePromise;
      closed = true; started = false;
      if (refreshTimer !== undefined) unschedule(refreshTimer);
      if (staleTimer !== undefined) unschedule(staleTimer);
      refreshTimer = undefined; staleTimer = undefined; stopAnimation(); unmount();
      closePromise = (async () => { await inFlight?.catch(() => {}); await closeActivity(); })();
      return closePromise;
    },
  };
}
