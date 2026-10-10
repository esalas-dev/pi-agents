# Tasks: Consulta, listado y espera

**Input**: [spec.md](spec.md) y [plan.md](plan.md).

**Prerequisites**: Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

**Estado del registro**: 48 pasos importados; 0 marcados en el original.
**Uso histórico; NO EJECUTAR como backlog nuevo.** El roadmap da por completada la fase. Las casillas
se importan sin reinterpretar: una casilla vacía no acredita trabajo pendiente ni autoriza repetirlo.
Antes de reusar este plan se requiere reconciliarlo con la evidencia y una solicitud humana nueva.

**Tests**: Se preservan pruebas, comandos, expected failures y gates; no son resultados obtenidos
ahora. Nuevos cambios requieren los controles de la constitución.

**Organization**: Cada paso tiene ID Tnnn. Los US apuntan a escenarios de spec.md. Los nombres T1,
T2… del detalle técnico original identifican bloques, no los nuevos IDs de pasos T001, T002…

## Phase 1: Preparación y autoridad

No se añaden pasos previos nuevos. Aplican la aprobación, dependencias y gates del plan.

## Phase 2: User Story 1 - Consultar y recuperar trabajos con revisión separada (Priority: P1)

### Bloque 1: Extender contratos y documentos al esquema 3

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

- [ ] T001 [US1] Escribir la prueba fallida — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, src/infrastructure/durable/documents.ts, tests/fixtures/v2/README.md, tests/helpers/v2.mjs, tests/query-contracts.test.mjs`

Crear pruebas de contratos que comprueben: filtros inválidos, límite permitido `1..100`, timeout `0..300`, estados de revisión válidos, consumo inicial `count: 0`, y que una vista compacta no contiene tarea ni cuerpo de resultado.

- [ ] T002 [US1] Confirmar el fallo esperado — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, src/infrastructure/durable/documents.ts, tests/fixtures/v2/README.md, tests/helpers/v2.mjs, tests/query-contracts.test.mjs`

Run: `node --test tests/query-contracts.test.mjs`
Expected: FAIL porque los tipos/documentos y errores de fase 01 aún no existen.

- [ ] T003 [US1] Implementar contratos mínimos — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, src/infrastructure/durable/documents.ts, tests/fixtures/v2/README.md, tests/helpers/v2.mjs, tests/query-contracts.test.mjs`

Añadir los tipos exactos y definir:

```ts
JobReviewDocFamily: { status: ReviewState; decidedAt?: number; decidedBy?: string; reason?: string }
JobConsumptionDocFamily: { firstConsumedAt?: number; lastConsumedAt?: number; count: number; lastConsumer?: string; requestIds: string[] }
```

Extender `JobsIndex` con `reviewStatus`, `hasResult` y los campos necesarios para ordenar; extender `RequestRecord` con operación tipada y recibo JSON compatible con `start`, `consume` y `review`. No guardar cuerpos de resultados en índice, revisión o consumo.

- [ ] T004 [US1] Confirmar que la prueba pasa — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, src/infrastructure/durable/documents.ts, tests/fixtures/v2/README.md, tests/helpers/v2.mjs, tests/query-contracts.test.mjs`

Run: `node --test tests/query-contracts.test.mjs`
Expected: PASS.

- [ ] T005 [US1] Registrar commit autorizado — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, src/infrastructure/durable/documents.ts, tests/fixtures/v2/README.md, tests/helpers/v2.mjs, tests/query-contracts.test.mjs`

```bash
git add src/domain src/infrastructure/durable/documents.ts tests/fixtures/v2 tests/helpers/v2.mjs tests/query-contracts.test.mjs
git commit -m "feat: define phase 01 query and review contracts"
```

### Bloque 2: Implementar vistas, filtros y paginación estable

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

- [ ] T006 [US1] Escribir la prueba fallida — alcance: `src/infrastructure/durable/repository.ts, src/application/query.ts, tests/query.test.mjs`

Añadir jobs con timestamps repetidos, estados `queued/running/completed/failed`, agentes distintos y resultados grandes. Probar `getJob`, filtros combinados, orden descendente, límite 1/100, cursor entre páginas, cursor malformado y que la lectura de listado no accede a `JobResultDocFamily` ni incluye tarea por defecto.

- [ ] T007 [US1] Confirmar el fallo esperado — alcance: `src/infrastructure/durable/repository.ts, src/application/query.ts, tests/query.test.mjs`

Run: `node --test tests/query.test.mjs`
Expected: FAIL porque no existen vistas ni listado.

- [ ] T008 [US1] Implementar repositorio y consultas — alcance: `src/infrastructure/durable/repository.ts, src/application/query.ts, tests/query.test.mjs`

Crear un cursor codificado con versión, `createdAt` e ID; rechazar alteraciones y cursores incompatibles con `INVALID_FILTER`. Filtrar sobre resúmenes primero y leer cada `JobDocFamily` solo para los items seleccionados. `getJob` combinará job, posición, `resultMeta`, `reviewStatus`, `consumption` y `hasResult`, sin materializar resultado salvo una operación explícita posterior.

- [ ] T009 [US1] Confirmar que la prueba pasa — alcance: `src/infrastructure/durable/repository.ts, src/application/query.ts, tests/query.test.mjs`

Run: `node --test tests/query.test.mjs`
Expected: PASS.

- [ ] T010 [US1] Registrar commit autorizado — alcance: `src/infrastructure/durable/repository.ts, src/application/query.ts, tests/query.test.mjs`

```bash
git add src/infrastructure/durable/repository.ts src/application/query.ts tests/query.test.mjs
git commit -m "feat: add stable job queries and pagination"
```

### Bloque 3: Implementar espera durable y cancelable

**Files:**
- Create: `src/application/wait.ts`
- Modify: `src/application/jobs.ts`
- Test: `tests/wait.test.mjs`

**Interfaces:**
- Consumes: `query.getJob`, `Session.watchDoc`, `JobDocFamily`, `WaitOptions` y errores de Task 1.
- Produces: `waitForJob(id: string, options: WaitOptions): Promise<Outcome<JobQueryView>>` y `JobsService.waitForJob`.

- [ ] T011 [US1] Escribir la prueba fallida — alcance: `src/application/wait.ts, src/application/jobs.ts, tests/wait.test.mjs`

Probar job ya terminal antes de esperar, transición durante la suscripción, transición entre snapshot y `watchDoc`, `until: "completed"`, timeout `0`, timeout positivo, `AbortSignal`, job inexistente y que timeout/aborto no cambia estado ni resultado del job.

- [ ] T012 [US1] Confirmar el fallo esperado — alcance: `src/application/wait.ts, src/application/jobs.ts, tests/wait.test.mjs`

Run: `node --test tests/wait.test.mjs`
Expected: FAIL porque no existe el servicio de espera.

- [ ] T013 [US1] Implement `waitForJob` — alcance: `src/application/wait.ts, src/application/jobs.ts, tests/wait.test.mjs`

Leer primero la vista. Si no satisface `until`, adquirir `watchDoc(JobDocFamily,id)`, volver a leer inmediatamente y después iniciar el listener. El listener debe detenerse al cumplir el predicado; `finally` debe llamar a `watch.stop()`. Usar timeout acotado `0..300` y `AbortSignal` sin llamar a ningún API de abort del Harness.

- [ ] T014 [US1] Confirmar que la prueba pasa — alcance: `src/application/wait.ts, src/application/jobs.ts, tests/wait.test.mjs`

Run: `node --test tests/wait.test.mjs`
Expected: PASS.

- [ ] T015 [US1] Registrar commit autorizado — alcance: `src/application/wait.ts, src/application/jobs.ts, tests/wait.test.mjs`

```bash
git add src/application/wait.ts src/application/jobs.ts tests/wait.test.mjs
git commit -m "feat: add non-cancelling durable job waits"
```

### Bloque 4: Implementar resultado, revisión y consumo idempotente

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

- [ ] T016 [US1] Escribir la prueba fallida — alcance: `src/application/result.ts, src/application/review.ts, src/infrastructure/durable/repository.ts, src/application/jobs.ts, tests/review-consume.test.mjs`

Probar `RESULT_NOT_READY`, `peek` humano sin mutación, tool bloqueada para `pending`/`rejected`, aprobación/rechazo solo con actor humano, `consume` aprobado, replay del mismo `requestId`, conflicto del mismo ID con payload distinto, consumidor distinto, `requestIds` limitado a 32 y persistencia tras reapertura.

- [ ] T017 [US1] Confirmar el fallo esperado — alcance: `src/application/result.ts, src/application/review.ts, src/infrastructure/durable/repository.ts, src/application/jobs.ts, tests/review-consume.test.mjs`

Run: `node --test tests/review-consume.test.mjs`
Expected: FAIL porque no existen documentos ni operaciones de revisión/consumo.

- [ ] T018 [US1] Implementar resultado, revisión y consumo atómicos — alcance: `src/application/result.ts, src/application/review.ts, src/infrastructure/durable/repository.ts, src/application/jobs.ts, tests/review-consume.test.mjs`

`peek` leerá el cuerpo sin escribir. `consume` comprobará revisión y resultado dentro del mismo commit que inspecciona/escribe el ledger, actualizará contador/timestamps/último consumidor y devolverá un recibo. `decideReview` exigirá `actor.kind === "human"`, registrará motivo/actor/instante y actualizará la proyección del índice. Un replay compatible devolverá el recibo histórico; un payload distinto devolverá `REQUEST_ID_CONFLICT`.

- [ ] T019 [US1] Confirmar que la prueba pasa — alcance: `src/application/result.ts, src/application/review.ts, src/infrastructure/durable/repository.ts, src/application/jobs.ts, tests/review-consume.test.mjs`

Run: `node --test tests/review-consume.test.mjs`
Expected: PASS.

- [ ] T020 [US1] Registrar commit autorizado — alcance: `src/application/result.ts, src/application/review.ts, src/infrastructure/durable/repository.ts, src/application/jobs.ts, tests/review-consume.test.mjs`

```bash
git add src/application/result.ts src/application/review.ts src/infrastructure/durable/repository.ts src/application/jobs.ts tests/review-consume.test.mjs
git commit -m "feat: add review and idempotent result consumption"
```

### Bloque 5: Migrar esquema 2 a esquema 3

**Files:**
- Modify: `src/infrastructure/storage/inspect.ts`
- Modify: `src/infrastructure/storage/migrate.ts`
- Modify: `src/application/maintenance.ts`
- Create: `tests/fixtures/v2/phase-00.sqlite` vía helper reproducible, no binario versionado
- Test: `tests/migration-v2.test.mjs`

**Interfaces:**
- Consumes: `Lease`, `BackupReceipt`, `StorageMetaDoc`, documentos de Task 1 y `migrateV1` de fase 00.
- Produces: `migrateV2ToV3(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 3; migratedJobs: number }>` y mantenimiento bloqueante para runtime antiguo.

- [ ] T021 [US1] Escribir la prueba fallida — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/fixtures/v2/phase-00.sqlite, tests/migration-v2.test.mjs`

Construir una base esquema 2 con todos los estados, resultados grandes, jobs humanos/modelo y ledger de inicio. Verificar que una base 2 exige migración, una confirmación cancelada no abre Harness ni llama modelos, la migración conserva IDs/cola/resultados/notificaciones y crea revisión/consumo correctos.

- [ ] T022 [US1] Confirmar el fallo esperado — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/fixtures/v2/phase-00.sqlite, tests/migration-v2.test.mjs`

Run: `node --test tests/migration-v2.test.mjs`
Expected: FAIL porque inspección solo reconoce esquema 2 como actual y no existen documentos nuevos.

- [ ] T023 [US1] Implementar migración atómica 2→3 — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/fixtures/v2/phase-00.sqlite, tests/migration-v2.test.mjs`

Validar ruta canónica, hash de fuente y backup bajo el lease. Crear los documentos de revisión/consumo para cada job, extender índice/meta, actualizar ledger solo cuando corresponda y retirar/activar la versión anterior en una única transacción. Una base ya 3 debe devolver `migratedJobs: 0`; una versión desconocida o inconsistente debe bloquearse.

- [ ] T024 [US1] Confirmar que la prueba pasa — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/fixtures/v2/phase-00.sqlite, tests/migration-v2.test.mjs`

Run: `node --test tests/migration-v2.test.mjs tests/migration.test.mjs`
Expected: PASS; la ruta v1→2 existente sigue verde y v2→3 conserva los datos.

- [ ] T025 [US1] Registrar commit autorizado — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/fixtures/v2/phase-00.sqlite, tests/migration-v2.test.mjs`

```bash
git add src/infrastructure/storage src/application/maintenance.ts tests/helpers/v2.mjs tests/migration-v2.test.mjs
 git commit -m "feat: migrate phase 00 storage to schema 3"
```

### Bloque 6: Ampliar parser y presentación de comandos

**Files:**
- Modify: `src/command.ts`
- Modify: `src/adapters/pi/display.ts`
- Test: `tests/command.test.mjs`
- Test: `tests/pi-query-display.test.mjs`

**Interfaces:**
- Consumes: formatos actuales `start/status/result` y vistas de Task 2–4.
- Produces: parseo de `list`, `wait`, `approve`, `reject`; `formatList`, `formatWait`, `formatReview`; `truncateToolResult(result, maxBytes = 64 * 1024)` con longitud, SHA-256 y `truncated`.

- [ ] T026 [US1] Escribir la prueba fallida — alcance: `src/command.ts, src/adapters/pi/display.ts, tests/command.test.mjs, tests/pi-query-display.test.mjs`

Probar argumentos válidos/invalidos, estados repetidos, límites, cursores, timeout, razón con escapes, `approve/reject`, contenido UTF-8 que cruza 64 KiB, hash del cuerpo completo y que presentación humana no trunca.

- [ ] T027 [US1] Confirmar el fallo esperado — alcance: `src/command.ts, src/adapters/pi/display.ts, tests/command.test.mjs, tests/pi-query-display.test.mjs`

Run: `node --test tests/command.test.mjs tests/pi-query-display.test.mjs`
Expected: FAIL por comandos y renderers ausentes.

- [ ] T028 [US1] Implementar parser y presentación — alcance: `src/command.ts, src/adapters/pi/display.ts, tests/command.test.mjs, tests/pi-query-display.test.mjs`

Conservar compatibilidad de los comandos existentes. El truncado debe contar bytes UTF-8 sin cortar un carácter inválido, calcular SHA-256 sobre el cuerpo completo y devolver metadatos en vez de escribir archivos temporales.

- [ ] T029 [US1] Confirmar que la prueba pasa — alcance: `src/command.ts, src/adapters/pi/display.ts, tests/command.test.mjs, tests/pi-query-display.test.mjs`

Run: `node --test tests/command.test.mjs tests/pi-query-display.test.mjs`
Expected: PASS.

- [ ] T030 [US1] Registrar commit autorizado — alcance: `src/command.ts, src/adapters/pi/display.ts, tests/command.test.mjs, tests/pi-query-display.test.mjs`

```bash
git add src/command.ts src/adapters/pi/display.ts tests/command.test.mjs tests/pi-query-display.test.mjs
git commit -m "feat: add query command parsing and bounded display"
```

### Bloque 7: Registrar servicios de consulta en Pi

**Files:**
- Modify: `src/adapters/pi/register.ts`
- Modify: `src/adapters/pi/resolve.ts`
- Create: `tests/helpers/pi-query-host.mjs`
- Test: `tests/pi-query-adapters.test.mjs`

**Interfaces:**
- Consumes: `JobsService`, parser/display de Task 6, `ExtensionContext`, bindings de Pi y política TUI-only de fase 00.
- Produces: registros de comandos existentes y nuevos, además de `pi_agents_status`, `pi_agents_list`, `pi_agents_wait`, `pi_agents_result`; las tools devolverán recibos/errores normalizados y nunca cuerpos no autorizados.

- [ ] T031 [US1] Escribir la prueba fallida — alcance: `src/adapters/pi/register.ts, src/adapters/pi/resolve.ts, tests/helpers/pi-query-host.mjs, tests/pi-query-adapters.test.mjs`

Usar host simulado para comprobar nombres exactos, schemas (`id`, filtros, `timeout_seconds`, `consume`, `request_id`), actor de comando/tool, retorno inmediato de wait y que llamadas RPC/headless no pueden aprobar revisión. Verificar que los comandos humanos muestran cuerpos pendientes.

- [ ] T032 [US1] Confirmar el fallo esperado — alcance: `src/adapters/pi/register.ts, src/adapters/pi/resolve.ts, tests/helpers/pi-query-host.mjs, tests/pi-query-adapters.test.mjs`

Run: `node --test tests/pi-query-adapters.test.mjs`
Expected: FAIL porque el registro actual solo expone `pi_agents`, status y result básicos.

- [ ] T033 [US1] Implementar adaptadores — alcance: `src/adapters/pi/register.ts, src/adapters/pi/resolve.ts, tests/helpers/pi-query-host.mjs, tests/pi-query-adapters.test.mjs`

Resolver la sesión una sola vez y delegar todas las transiciones a `JobsService`. `pi_agents_result` usará `access.mode: "tool"`, exigirá `request_id` cuando `consume: true` y aplicará `truncateToolResult`. `approve/reject` comprobarán `ctx.mode === "tui" && ctx.hasUI` antes de llamar al servicio.

- [ ] T034 [US1] Confirmar que la prueba pasa — alcance: `src/adapters/pi/register.ts, src/adapters/pi/resolve.ts, tests/helpers/pi-query-host.mjs, tests/pi-query-adapters.test.mjs`

Run: `node --test tests/pi-query-adapters.test.mjs`
Expected: PASS.

- [ ] T035 [US1] Registrar commit autorizado — alcance: `src/adapters/pi/register.ts, src/adapters/pi/resolve.ts, tests/helpers/pi-query-host.mjs, tests/pi-query-adapters.test.mjs`

```bash
git add src/adapters/pi/register.ts src/adapters/pi/resolve.ts tests/helpers/pi-query-host.mjs tests/pi-query-adapters.test.mjs
git commit -m "feat: expose durable query services through Pi"
```

### Bloque 8: Integrar lifecycle y bloqueo de esquema

**Files:**
- Modify: `src/runtime/session.ts`
- Modify: `src/application/jobs.ts`
- Modify: `src/infrastructure/storage/inspect.ts`
- Test: `tests/session-query-runtime.test.mjs`

**Interfaces:**
- Consumes: migración 2→3 de Task 5, servicios de Task 2–4 y adaptadores de Task 7.
- Produces: runtime que no activa Harness sobre esquema 2, conserva revisión/consumo tras close/reopen y recupera esperas solo desde snapshots, nunca desde promesas persistidas.

- [ ] T036 [US1] Escribir la prueba fallida — alcance: `src/runtime/session.ts, src/application/jobs.ts, src/infrastructure/storage/inspect.ts, tests/session-query-runtime.test.mjs`

Probar apertura de esquema 2 con `MIGRATION_REQUIRED`, ausencia de llamadas al proveedor, apertura de esquema 3, close idempotente, lectura de revisión/consumo tras reapertura, y dos sesiones sin compartir SQLite.

- [ ] T037 [US1] Confirmar el fallo esperado — alcance: `src/runtime/session.ts, src/application/jobs.ts, src/infrastructure/storage/inspect.ts, tests/session-query-runtime.test.mjs`

Run: `node --test tests/session-query-runtime.test.mjs`
Expected: FAIL porque el runtime acepta únicamente el esquema 2 y no compone los nuevos servicios.

- [ ] T038 [US1] Implementar composición runtime — alcance: `src/runtime/session.ts, src/application/jobs.ts, src/infrastructure/storage/inspect.ts, tests/session-query-runtime.test.mjs`

Componer `QueryService`, `WaitService`, `ResultService` y `ReviewService` en `JobsService`; validar schema 3 después de migración y antes de `Harness.open`. Mantener cleanup inverso, lease único y recuperación de jobs activa sin mantener esperas en memoria como autoridad.

- [ ] T039 [US1] Confirmar que la prueba pasa — alcance: `src/runtime/session.ts, src/application/jobs.ts, src/infrastructure/storage/inspect.ts, tests/session-query-runtime.test.mjs`

Run: `node --test tests/session-query-runtime.test.mjs tests/session-runtime.test.mjs`
Expected: PASS.

- [ ] T040 [US1] Registrar commit autorizado — alcance: `src/runtime/session.ts, src/application/jobs.ts, src/infrastructure/storage/inspect.ts, tests/session-query-runtime.test.mjs`

```bash
git add src/runtime/session.ts src/application/jobs.ts src/infrastructure/storage/inspect.ts tests/session-query-runtime.test.mjs
git commit -m "feat: compose phase 01 query runtime"
```

### Bloque 9: Actualizar documentación y pruebas de aceptación

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `specs/ROADMAP.md`
- Create: `docs/PHASE-01-ACCEPTANCE.md`
- Test: `tests/phase-01-acceptance.test.mjs`

**Interfaces:**
- Consumes: comandos/tools y resultados de Tasks 1–8.
- Produces: documentación de operación, migración 2→3, revisión/consumo y matriz AC-01; no modifica comportamiento.

- [ ] T041 [US1] Escribir la prueba fallida — alcance: `docs/ARCHITECTURE.md, specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md, tests/phase-01-acceptance.test.mjs`

Crear una prueba estructural que compruebe enlaces, nombres de comandos/tools, ausencia de `TODO/TBD`, fences válidos y que la documentación describe el límite 64 KiB, el bloqueo de schema 2 y la semántica de espera.

- [ ] T042 [US1] Confirmar el fallo esperado — alcance: `docs/ARCHITECTURE.md, specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md, tests/phase-01-acceptance.test.mjs`

Run: `node --test tests/phase-01-acceptance.test.mjs`
Expected: FAIL porque la documentación todavía describe solo fase 00.

- [ ] T043 [US1] Actualizar documentación — alcance: `docs/ARCHITECTURE.md, specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md, tests/phase-01-acceptance.test.mjs`

Documentar `list/wait/approve/reject`, las cuatro tools nuevas, filtros/cursor, `peek/consume`, revisión humana, migración 2→3, restauración y límites de seguridad. Cambiar fase 01 en el roadmap a `en validación` hasta completar los gates; no declararla completada solo por pruebas unitarias.

- [ ] T044 [US1] Confirmar que la prueba pasa — alcance: `docs/ARCHITECTURE.md, specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md, tests/phase-01-acceptance.test.mjs`

Run: `node --test tests/phase-01-acceptance.test.mjs`
Expected: PASS.

- [ ] T045 [US1] Registrar commit autorizado — alcance: `docs/ARCHITECTURE.md, specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md, tests/phase-01-acceptance.test.mjs`

```bash
git add README.md docs/ARCHITECTURE.md docs/PHASE-01-ACCEPTANCE.md specs/ROADMAP.md tests/phase-01-acceptance.test.mjs
git commit -m "docs: document phase 01 query operations"
```

### Bloque 10: Gate final de fase 01

**Files:**
- Modify: `specs/ROADMAP.md` solo si todos los gates pasan.
- Modify: `docs/PHASE-01-ACCEPTANCE.md` con evidencia real.

**Interfaces:**
- Consumes: todos los servicios, adaptadores, migración y pruebas anteriores.
- Produces: rama verificable; fase queda `en validación` si falta aceptación humana/revisión, o `completada` solo con todos los gates.

- [ ] T046 [US1] Ejecutar verificación completa — alcance: `specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md`

Run:

```bash
npm run check
npm test
PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_phase01_smoke_no_match__
npm pack --dry-run --json
```

Expected: type-check/syntax green, all tests green, smoke con código 0 y paquete sin SQLite/backups/config local.

- [ ] T047 [US1] Revisar evidencia de aceptación — alcance: `specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md`

Comprobar que existen pruebas de carrera, migración 2→3, consumo replay, revisión, truncado UTF-8, schema blocking y reapertura. Registrar limitaciones; no atribuir pruebas TUI o revisión independiente si no se realizaron.

- [ ] T048 [US1] Registrar commit final autorizado — alcance: `specs/ROADMAP.md, docs/PHASE-01-ACCEPTANCE.md`

```bash
git add specs/ROADMAP.md docs/PHASE-01-ACCEPTANCE.md
git commit -m "test: verify phase 01 query and review operations"
```

## Dependencies & Execution Order

- Mantener el orden de bloques y de pasos del original; cada paso depende del anterior.
- No se asigna [P]: no se ha demostrado independencia de archivos ni contratos durante la migración.
- Para widget: US2 requiere la aceptación humana de US1; cerrar UI no cancela jobs.
- Pruebas rojas/verdes, migración, privacidad y aceptación conservan sus gates originales.
- Commits y promoción requieren autorización explícita; describirlos no autoriza ejecutarlos.

### Trazabilidad de bloques originales

| Bloque original | Historia | IDs importados |
| --- | --- | --- |
| Bloque 1 | US1 | T001–T005 |
| Bloque 2 | US1 | T006–T010 |
| Bloque 3 | US1 | T011–T015 |
| Bloque 4 | US1 | T016–T020 |
| Bloque 5 | US1 | T021–T025 |
| Bloque 6 | US1 | T026–T030 |
| Bloque 7 | US1 | T031–T035 |
| Bloque 8 | US1 | T036–T040 |
| Bloque 9 | US1 | T041–T045 |
| Bloque 10 | US1 | T046–T048 |

## Implementation Strategy

Ejecutar solo después de confirmar autoridad y el estado actual del trabajo. Verificar el escenario
independiente de cada historia, registrar versiones/comandos/resultados y detenerse ante fallos.
No cerrar fases por marcar casillas ni sustituir revisión independiente o aceptación humana por mocks.

## Notes

Original completo: [archivo histórico](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-06-fase-01-consulta-listado-espera.md).
Las discrepancias de estado se registran en [MIGRATION.md](../MIGRATION.md), no se resuelven
inventando comprobaciones, cambiando casillas o implementando funciones.
