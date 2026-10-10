# Fase 01 — Consulta, listado y espera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir consulta, listado paginado, espera cancelable, revisión humana y consumo idempotente sobre el esquema Durable 2, mediante una migración explícita al esquema 3.

**Architecture:** La aplicación expondrá servicios de lectura y decisión sobre el repositorio de fase 00; los adaptadores Pi solo traducirán comandos/tools, actores y presentación. `JobsIndexDoc` seguirá siendo una proyección compacta para filtros y cursores; revisión, consumo y cuerpos de resultado permanecerán en documentos separados. La espera usará `watchDoc` con el patrón snapshot → suscripción → snapshot y nunca modificará el job.

**Tech Stack:** TypeScript estricto, Node.js 26.10.0, `@earendil-works/pi-durable` 1.0.1, Chord, SQLite público `node:sqlite`, Pi 1.0.4, Node test runner y fixtures Durable en SQLite.

**Spec:** `specs/01-consulta-listado-espera.md`

## Global Constraints

- Compatibilidad objetivo: macOS arm64, Node `26.10.0`, Pi `1.0.4` y Pi Durable `1.0.1`.
- No instalar dependencias ni modificar declaraciones del host; usar únicamente APIs públicas y bindings inyectables en pruebas.
- Mantener un SQLite por sesión; no abrir SQLite de otras sesiones simultáneamente.
- La fase no implementa cancelación, pausa, retry, RPC, streaming, gates, grupos, worktrees, steering, cron, workflows ni promoción.
- Las tools no pueden aprobar/rechazar resultados ni devolver cuerpos `pending` o `rejected`.
- El límite textual de una tool es `64 KiB`; el cuerpo completo permanece en `JobResultDocFamily`.
- El cursor de listado es opaco y representa `(createdAt,id)` descendente; no depende de `JobsIndexDoc.order`.
- `consume` exige `requestId` para deduplicación fuerte; el ledger es la autoridad, no la ventana histórica del documento de consumo.
- Migrar esquema 2→3 requiere autorización humana TUI, backup consistente y bloqueo del runtime mientras la base no esté convertida.
- El resultado humano usa `peek` por defecto; aprobar no ejecuta comandos, fusiona ramas ni promueve artefactos.
- Todos los documentos de revisión, consumo y ledger se actualizan atómicamente con las mutaciones que representan.

## Review Focus

- **Race snapshot/watch:** un job que termina entre la primera lectura y la suscripción debe satisfacer `wait` sin perder la transición; lo fija Task 3.
- **Cursor con timestamps repetidos:** jobs con el mismo `createdAt` deben paginar sin duplicar ni omitir IDs; lo fija Task 2.
- **Replay de consume:** mismo `requestId` debe devolver el recibo original sin incrementar el contador; lo fija Task 4.
- **Filtrado de resultados sensibles:** tools no deben filtrar cuerpos `pending`/`rejected` ni superar 64 KiB; lo fija Task 8.
- **Runtime en esquema antiguo:** una base 2 no debe abrir el Harness ni llamar al proveedor antes de una migración TUI autorizada; lo fija Task 5 y Task 9.

---

## Mapa de archivos

- `src/domain/jobs.ts`, `src/domain/errors.ts`, `src/domain/requests.ts`: tipos de vistas, filtros, espera, revisión, consumo y errores públicos.
- `src/infrastructure/durable/documents.ts`: documentos de revisión/consumo y esquema 3.
- `src/infrastructure/durable/repository.ts`: lectura compacta, cursores, ledger tipado y commits de consumo/revisión.
- `src/infrastructure/storage/inspect.ts`, `migrate.ts`, `src/application/maintenance.ts`: inspección y migración 2→3.
- `src/application/query.ts`, `review.ts`, `result.ts`: casos de uso independientes del host Pi.
- `src/adapters/pi/display.ts`, `resolve.ts`, `register.ts`, `src/command.ts`: comandos, tools, renderizado, truncado y autoridades de actor.
- `tests/fixtures/v2/`, `tests/helpers/`, `tests/query.test.mjs`, `tests/wait.test.mjs`, `tests/review-consume.test.mjs`, `tests/migration-v2.test.mjs`, `tests/pi-query-adapters.test.mjs`: fixtures y pruebas de aceptación.
- `README.md`, `docs/ARCHITECTURE.md`, `specs/ROADMAP.md`: documentación de la interfaz y estado de fase.

---

### Task 1: Extender contratos y documentos al esquema 3

**Files:**
- Modify: `src/domain/jobs.ts`
- Modify: `src/domain/errors.ts`
- Modify: `src/domain/requests.ts`
- Modify: `src/infrastructure/durable/documents.ts`
- Create: `tests/fixtures/v2/README.md`
- Create: `tests/helpers/v2.mjs`
- Test: `tests/query-contracts.test.mjs`

**Interfaces:**
- Consumes: `JobRecord`, `JobResult`, `Actor`, `canonicalStart()` y documentos de esquema 2 de fase 00.
- Produces: `JobFilter`, `JobListView`, `JobQueryView`, `WaitOptions`, `WaitResult`, `ReviewState`, `ConsumptionState`, `ResultAccess`, `ReviewDecision`, `JobReviewDocFamily`, `JobConsumptionDocFamily` y errores `INVALID_FILTER`, `WAIT_TIMEOUT`, `WAIT_ABORTED`, `RESULT_NOT_READY`, `RESULT_REVIEW_REQUIRED`, `RESULT_REJECTED`.

- [ ] **Step 1: Write the failing test**

Crear pruebas de contratos que comprueben: filtros inválidos, límite permitido `1..100`, timeout `0..300`, estados de revisión válidos, consumo inicial `count: 0`, y que una vista compacta no contiene tarea ni cuerpo de resultado.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query-contracts.test.mjs`
Expected: FAIL porque los tipos/documentos y errores de fase 01 aún no existen.

- [ ] **Step 3: Implement the minimal contracts**

Añadir los tipos exactos y definir:

```ts
JobReviewDocFamily: { status: ReviewState; decidedAt?: number; decidedBy?: string; reason?: string }
JobConsumptionDocFamily: { firstConsumedAt?: number; lastConsumedAt?: number; count: number; lastConsumer?: string; requestIds: string[] }
```

Extender `JobsIndex` con `reviewStatus`, `hasResult` y los campos necesarios para ordenar; extender `RequestRecord` con operación tipada y recibo JSON compatible con `start`, `consume` y `review`. No guardar cuerpos de resultados en índice, revisión o consumo.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query-contracts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain src/infrastructure/durable/documents.ts tests/fixtures/v2 tests/helpers/v2.mjs tests/query-contracts.test.mjs
git commit -m "feat: define phase 01 query and review contracts"
```

### Task 2: Implementar vistas, filtros y paginación estable

**Files:**
- Modify: `src/infrastructure/durable/repository.ts`
- Create: `src/application/query.ts`
- Test: `tests/query.test.mjs`

**Interfaces:**
- Consumes: `JobRepository`, `JobsIndexDoc`, `JobDocFamily`, `JobResultDocFamily` y contratos de Task 1.
- Produces:
  - `getJob(id: string, options?: { includeTask?: boolean }): Promise<Outcome<JobQueryView>>`
  - `listJobs(filter: JobFilter): Promise<Outcome<{ items: readonly JobListView[]; nextCursor?: string }>>`
  - cursor opaco estable por `(createdAt,id)` descendente.

- [ ] **Step 1: Write the failing test**

Añadir jobs con timestamps repetidos, estados `queued/running/completed/failed`, agentes distintos y resultados grandes. Probar `getJob`, filtros combinados, orden descendente, límite 1/100, cursor entre páginas, cursor malformado y que la lectura de listado no accede a `JobResultDocFamily` ni incluye tarea por defecto.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/query.test.mjs`
Expected: FAIL porque no existen vistas ni listado.

- [ ] **Step 3: Implement repository/query layer**

Crear un cursor codificado con versión, `createdAt` e ID; rechazar alteraciones y cursores incompatibles con `INVALID_FILTER`. Filtrar sobre resúmenes primero y leer cada `JobDocFamily` solo para los items seleccionados. `getJob` combinará job, posición, `resultMeta`, `reviewStatus`, `consumption` y `hasResult`, sin materializar resultado salvo una operación explícita posterior.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/query.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/durable/repository.ts src/application/query.ts tests/query.test.mjs
git commit -m "feat: add stable job queries and pagination"
```

### Task 3: Implementar espera durable y cancelable

**Files:**
- Create: `src/application/wait.ts`
- Modify: `src/application/jobs.ts`
- Test: `tests/wait.test.mjs`

**Interfaces:**
- Consumes: `query.getJob`, `Session.watchDoc`, `JobDocFamily`, `WaitOptions` y errores de Task 1.
- Produces: `waitForJob(id: string, options: WaitOptions): Promise<Outcome<JobQueryView>>` y `JobsService.waitForJob`.

- [ ] **Step 1: Write the failing test**

Probar job ya terminal antes de esperar, transición durante la suscripción, transición entre snapshot y `watchDoc`, `until: "completed"`, timeout `0`, timeout positivo, `AbortSignal`, job inexistente y que timeout/aborto no cambia estado ni resultado del job.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/wait.test.mjs`
Expected: FAIL porque no existe el servicio de espera.

- [ ] **Step 3: Implement `waitForJob`**

Leer primero la vista. Si no satisface `until`, adquirir `watchDoc(JobDocFamily,id)`, volver a leer inmediatamente y después iniciar el listener. El listener debe detenerse al cumplir el predicado; `finally` debe llamar a `watch.stop()`. Usar timeout acotado `0..300` y `AbortSignal` sin llamar a ningún API de abort del Harness.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/wait.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/wait.ts src/application/jobs.ts tests/wait.test.mjs
git commit -m "feat: add non-cancelling durable job waits"
```

### Task 4: Implementar resultado, revisión y consumo idempotente

**Files:**
- Create: `src/application/result.ts`
- Create: `src/application/review.ts`
- Modify: `src/infrastructure/durable/repository.ts`
- Modify: `src/application/jobs.ts`
- Test: `tests/review-consume.test.mjs`

**Interfaces:**
- Consumes: `JobResultDocFamily`, `JobReviewDocFamily`, `JobConsumptionDocFamily`, ledger tipado y `JobQueryView`.
- Produces:
  - `getResult(id: string, access: ResultAccess): Promise<Outcome<ResultView>>`
  - `decideReview(id: string, decision: ReviewDecision): Promise<Outcome<ReviewReceipt>>`
  - `consumeResult(id: string, request: ConsumeRequest): Promise<Outcome<ConsumeReceipt>>`
  - métodos correspondientes en `JobsService`.

- [ ] **Step 1: Write the failing test**

Probar `RESULT_NOT_READY`, `peek` humano sin mutación, tool bloqueada para `pending`/`rejected`, aprobación/rechazo solo con actor humano, `consume` aprobado, replay del mismo `requestId`, conflicto del mismo ID con payload distinto, consumidor distinto, `requestIds` limitado a 32 y persistencia tras reapertura.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/review-consume.test.mjs`
Expected: FAIL porque no existen documentos ni operaciones de revisión/consumo.

- [ ] **Step 3: Implement atomic result/review/consume operations**

`peek` leerá el cuerpo sin escribir. `consume` comprobará revisión y resultado dentro del mismo commit que inspecciona/escribe el ledger, actualizará contador/timestamps/último consumidor y devolverá un recibo. `decideReview` exigirá `actor.kind === "human"`, registrará motivo/actor/instante y actualizará la proyección del índice. Un replay compatible devolverá el recibo histórico; un payload distinto devolverá `REQUEST_ID_CONFLICT`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/review-consume.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/result.ts src/application/review.ts src/infrastructure/durable/repository.ts src/application/jobs.ts tests/review-consume.test.mjs
git commit -m "feat: add review and idempotent result consumption"
```

### Task 5: Migrar esquema 2 a esquema 3

**Files:**
- Modify: `src/infrastructure/storage/inspect.ts`
- Modify: `src/infrastructure/storage/migrate.ts`
- Modify: `src/application/maintenance.ts`
- Create: `tests/fixtures/v2/phase-00.sqlite` vía helper reproducible, no binario versionado
- Test: `tests/migration-v2.test.mjs`

**Interfaces:**
- Consumes: `Lease`, `BackupReceipt`, `StorageMetaDoc`, documentos de Task 1 y `migrateV1` de fase 00.
- Produces: `migrateV2ToV3(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 3; migratedJobs: number }>` y mantenimiento bloqueante para runtime antiguo.

- [ ] **Step 1: Write the failing test**

Construir una base esquema 2 con todos los estados, resultados grandes, jobs humanos/modelo y ledger de inicio. Verificar que una base 2 exige migración, una confirmación cancelada no abre Harness ni llama modelos, la migración conserva IDs/cola/resultados/notificaciones y crea revisión/consumo correctos.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/migration-v2.test.mjs`
Expected: FAIL porque inspección solo reconoce esquema 2 como actual y no existen documentos nuevos.

- [ ] **Step 3: Implement atomic 2→3 migration**

Validar ruta canónica, hash de fuente y backup bajo el lease. Crear los documentos de revisión/consumo para cada job, extender índice/meta, actualizar ledger solo cuando corresponda y retirar/activar la versión anterior en una única transacción. Una base ya 3 debe devolver `migratedJobs: 0`; una versión desconocida o inconsistente debe bloquearse.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/migration-v2.test.mjs tests/migration.test.mjs`
Expected: PASS; la ruta v1→2 existente sigue verde y v2→3 conserva los datos.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/storage src/application/maintenance.ts tests/helpers/v2.mjs tests/migration-v2.test.mjs
 git commit -m "feat: migrate phase 00 storage to schema 3"
```

### Task 6: Ampliar parser y presentación de comandos

**Files:**
- Modify: `src/command.ts`
- Modify: `src/adapters/pi/display.ts`
- Test: `tests/command.test.mjs`
- Test: `tests/pi-query-display.test.mjs`

**Interfaces:**
- Consumes: formatos actuales `start/status/result` y vistas de Task 2–4.
- Produces: parseo de `list`, `wait`, `approve`, `reject`; `formatList`, `formatWait`, `formatReview`; `truncateToolResult(result, maxBytes = 64 * 1024)` con longitud, SHA-256 y `truncated`.

- [ ] **Step 1: Write the failing test**

Probar argumentos válidos/invalidos, estados repetidos, límites, cursores, timeout, razón con escapes, `approve/reject`, contenido UTF-8 que cruza 64 KiB, hash del cuerpo completo y que presentación humana no trunca.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/command.test.mjs tests/pi-query-display.test.mjs`
Expected: FAIL por comandos y renderers ausentes.

- [ ] **Step 3: Implement parser/display**

Conservar compatibilidad de los comandos existentes. El truncado debe contar bytes UTF-8 sin cortar un carácter inválido, calcular SHA-256 sobre el cuerpo completo y devolver metadatos en vez de escribir archivos temporales.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/command.test.mjs tests/pi-query-display.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/command.ts src/adapters/pi/display.ts tests/command.test.mjs tests/pi-query-display.test.mjs
git commit -m "feat: add query command parsing and bounded display"
```

### Task 7: Registrar servicios de consulta en Pi

**Files:**
- Modify: `src/adapters/pi/register.ts`
- Modify: `src/adapters/pi/resolve.ts`
- Create: `tests/helpers/pi-query-host.mjs`
- Test: `tests/pi-query-adapters.test.mjs`

**Interfaces:**
- Consumes: `JobsService`, parser/display de Task 6, `ExtensionContext`, bindings de Pi y política TUI-only de fase 00.
- Produces: registros de comandos existentes y nuevos, además de `pi_agents_status`, `pi_agents_list`, `pi_agents_wait`, `pi_agents_result`; las tools devolverán recibos/errores normalizados y nunca cuerpos no autorizados.

- [ ] **Step 1: Write the failing test**

Usar host simulado para comprobar nombres exactos, schemas (`id`, filtros, `timeout_seconds`, `consume`, `request_id`), actor de comando/tool, retorno inmediato de wait y que llamadas RPC/headless no pueden aprobar revisión. Verificar que los comandos humanos muestran cuerpos pendientes.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/pi-query-adapters.test.mjs`
Expected: FAIL porque el registro actual solo expone `pi_agents`, status y result básicos.

- [ ] **Step 3: Implement adapters**

Resolver la sesión una sola vez y delegar todas las transiciones a `JobsService`. `pi_agents_result` usará `access.mode: "tool"`, exigirá `request_id` cuando `consume: true` y aplicará `truncateToolResult`. `approve/reject` comprobarán `ctx.mode === "tui" && ctx.hasUI` antes de llamar al servicio.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/pi-query-adapters.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/pi/register.ts src/adapters/pi/resolve.ts tests/helpers/pi-query-host.mjs tests/pi-query-adapters.test.mjs
git commit -m "feat: expose durable query services through Pi"
```

### Task 8: Integrar lifecycle y bloqueo de esquema

**Files:**
- Modify: `src/runtime/session.ts`
- Modify: `src/application/jobs.ts`
- Modify: `src/infrastructure/storage/inspect.ts`
- Test: `tests/session-query-runtime.test.mjs`

**Interfaces:**
- Consumes: migración 2→3 de Task 5, servicios de Task 2–4 y adaptadores de Task 7.
- Produces: runtime que no activa Harness sobre esquema 2, conserva revisión/consumo tras close/reopen y recupera esperas solo desde snapshots, nunca desde promesas persistidas.

- [ ] **Step 1: Write the failing test**

Probar apertura de esquema 2 con `MIGRATION_REQUIRED`, ausencia de llamadas al proveedor, apertura de esquema 3, close idempotente, lectura de revisión/consumo tras reapertura, y dos sesiones sin compartir SQLite.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-query-runtime.test.mjs`
Expected: FAIL porque el runtime acepta únicamente el esquema 2 y no compone los nuevos servicios.

- [ ] **Step 3: Implement runtime composition**

Componer `QueryService`, `WaitService`, `ResultService` y `ReviewService` en `JobsService`; validar schema 3 después de migración y antes de `Harness.open`. Mantener cleanup inverso, lease único y recuperación de jobs activa sin mantener esperas en memoria como autoridad.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-query-runtime.test.mjs tests/session-runtime.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/session.ts src/application/jobs.ts src/infrastructure/storage/inspect.ts tests/session-query-runtime.test.mjs
git commit -m "feat: compose phase 01 query runtime"
```

### Task 9: Actualizar documentación y pruebas de aceptación

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `specs/ROADMAP.md`
- Create: `docs/PHASE-01-ACCEPTANCE.md`
- Test: `tests/phase-01-acceptance.test.mjs`

**Interfaces:**
- Consumes: comandos/tools y resultados de Tasks 1–8.
- Produces: documentación de operación, migración 2→3, revisión/consumo y matriz AC-01; no modifica comportamiento.

- [ ] **Step 1: Write the failing test**

Crear una prueba estructural que compruebe enlaces, nombres de comandos/tools, ausencia de `TODO/TBD`, fences válidos y que la documentación describe el límite 64 KiB, el bloqueo de schema 2 y la semántica de espera.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/phase-01-acceptance.test.mjs`
Expected: FAIL porque la documentación todavía describe solo fase 00.

- [ ] **Step 3: Update documentation**

Documentar `list/wait/approve/reject`, las cuatro tools nuevas, filtros/cursor, `peek/consume`, revisión humana, migración 2→3, restauración y límites de seguridad. Cambiar fase 01 en el roadmap a `en validación` hasta completar los gates; no declararla completada solo por pruebas unitarias.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/phase-01-acceptance.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/ARCHITECTURE.md docs/PHASE-01-ACCEPTANCE.md specs/ROADMAP.md tests/phase-01-acceptance.test.mjs
git commit -m "docs: document phase 01 query operations"
```

### Task 10: Gate final de fase 01

**Files:**
- Modify: `specs/ROADMAP.md` solo si todos los gates pasan.
- Modify: `docs/PHASE-01-ACCEPTANCE.md` con evidencia real.

**Interfaces:**
- Consumes: todos los servicios, adaptadores, migración y pruebas anteriores.
- Produces: rama verificable; fase queda `en validación` si falta aceptación humana/revisión, o `completada` solo con todos los gates.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run check
npm test
PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_phase01_smoke_no_match__
npm pack --dry-run --json
```

Expected: type-check/syntax green, all tests green, smoke con código 0 y paquete sin SQLite/backups/config local.

- [ ] **Step 2: Review acceptance evidence**

Comprobar que existen pruebas de carrera, migración 2→3, consumo replay, revisión, truncado UTF-8, schema blocking y reapertura. Registrar limitaciones; no atribuir pruebas TUI o revisión independiente si no se realizaron.

- [ ] **Step 3: Commit final**

```bash
git add specs/ROADMAP.md docs/PHASE-01-ACCEPTANCE.md
git commit -m "test: verify phase 01 query and review operations"
```

## Plan self-review

- **Cobertura de spec:** RF-01/02 → Tasks 1–2; RF-03 → Task 3; RF-04/05 → Task 4; RF-06 → Task 6/7; migración → Task 5/8; comandos/tools → Task 6/7; recuperación/documentación → Tasks 8–10.
- **Consistencia de tipos:** `JobFilter`, `JobQueryView`, `WaitOptions`, `ResultAccess`, `ReviewDecision` nacen en Task 1 y son consumidos con los mismos nombres en Tasks 2–8.
- **Carreras:** snapshot/watch, timestamps repetidos y replay de ledger tienen pruebas propietarias explícitas.
- **Seguridad:** autorización TUI, filtrado de revisión y límite de salida se prueban antes de conectar el registro real.
- **Dependencias:** la migración precede la apertura schema 3; ningún task de adaptadores crea transiciones ni acceso SQL interno.
- **Limitación declarada:** no se promete aceptación de fase hasta ejecutar el gate final y obtener revisión/aceptación humana separada.
