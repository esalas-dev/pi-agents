# Tasks: Control durable del ciclo de vida

**Input**: [spec.md](spec.md) y [plan.md](plan.md).

**Prerequisites**: Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

**Estado del registro**: 38 pasos importados; 0 marcados en el original.
**Uso histórico; NO EJECUTAR como backlog nuevo.** El roadmap da por completada la fase. Las casillas
se importan sin reinterpretar: una casilla vacía no acredita trabajo pendiente ni autoriza repetirlo.
Antes de reusar este plan se requiere reconciliarlo con la evidencia y una solicitud humana nueva.

**Tests**: Se preservan pruebas, comandos, expected failures y gates; no son resultados obtenidos
ahora. Nuevos cambios requieren los controles de la constitución.

**Organization**: Cada paso tiene ID Tnnn. Los US apuntan a escenarios de spec.md. Los nombres T1,
T2… del detalle técnico original identifican bloques, no los nuevos IDs de pasos T001, T002…

## Phase 1: Preparación y autoridad

No se añaden pasos previos nuevos. Aplican la aprobación, dependencias y gates del plan.

## Phase 2: User Story 1 - Controlar un trabajo sin perder intención ni historial (Priority: P1)

### Bloque 1: Extender contratos y documentos al control durable

**Files:**
- Modify: `src/domain/jobs.ts`
- Modify: `src/domain/requests.ts`
- Modify: `src/domain/errors.ts`
- Modify: `src/infrastructure/durable/documents.ts`
- Test: `tests/control-contracts.test.mjs`

**Interfaces:**
- Consumes: `JobRecord`, `Actor`, `RequestRecord`, estado y documentos de fase 01.
- Produces: `JobStatus` con `paused`/`cancelling`/`cancelled`; `ControlAction`; `ControlRequest = { requestId: string; action: ControlAction; actor: Actor; reason?: string }`; `RetryRequest = Omit<ControlRequest, "action"> & { action: "retry" }`; `ControlReceipt`; `RetryReceipt`; `ControlEvent`; `ControlPolicy`; `JobControlDocument = { events: ControlEvent[] }`; errores `PAUSE_ACTIVE_UNSUPPORTED`, `CONTROL_INVALID_STATE`, `CONTROL_NOT_AUTHORIZED`, `CONTROL_CONFLICT` y `RETRY_NOT_ALLOWED`.

- [ ] T001 [US1] Escribir la prueba fallida — alcance: `src/domain/jobs.ts, src/domain/requests.ts, src/domain/errors.ts, src/infrastructure/durable/documents.ts, tests/control-contracts.test.mjs`

Comprobar estados públicos, acciones válidas, motivos de 2 KiB, recibos con estado anterior/resultante/replay, campos `retryOf`/`attemptNumber`/`rootAttemptId`, y que los documentos nuevos usan semillas deterministas.

- [ ] T002 [US1] Confirmar el fallo esperado — alcance: `src/domain/jobs.ts, src/domain/requests.ts, src/domain/errors.ts, src/infrastructure/durable/documents.ts, tests/control-contracts.test.mjs`

Run: `node --test tests/control-contracts.test.mjs`
Expected: FAIL porque los estados, tipos, documentos y errores nuevos no existen.

- [ ] T003 [US1] Implementar contratos mínimos — alcance: `src/domain/jobs.ts, src/domain/requests.ts, src/domain/errors.ts, src/infrastructure/durable/documents.ts, tests/control-contracts.test.mjs`

Extender `JobRecord` con `control`, `retryOf`, `attemptNumber`, `rootAttemptId`, `queueOrdinal` y `controlHistory` limitado. Definir `JobControlDocFamily` para historial append-only y mantener los resultados/consumos separados. Actualizar validadores y `transition()` sin permitir reanudar terminales.

- [ ] T004 [US1] Confirmar que la prueba pasa — alcance: `src/domain/jobs.ts, src/domain/requests.ts, src/domain/errors.ts, src/infrastructure/durable/documents.ts, tests/control-contracts.test.mjs`

Run: `node --test tests/control-contracts.test.mjs`
Expected: PASS.

- [ ] T005 [US1] Registrar commit autorizado — alcance: `src/domain/jobs.ts, src/domain/requests.ts, src/domain/errors.ts, src/infrastructure/durable/documents.ts, tests/control-contracts.test.mjs`

```bash
git add src/domain src/infrastructure/durable/documents.ts tests/control-contracts.test.mjs
git commit -m "feat: define durable lifecycle control contracts"
```

### Bloque 2: Implementar mutaciones atómicas de cola y control

**Files:**
- Modify: `src/infrastructure/durable/repository.ts`
- Create: `src/application/control.ts`
- Modify: `src/application/jobs.ts`
- Test: `tests/control.test.mjs`

**Interfaces:**
- Consumes: contratos de Task 1 (`ControlPolicy` incluida), `RequestLedgerDocFamily`, `JobsIndexDoc` y repositorio de fase 01.
- Produces:
  - `ControlService.control(id: string, request: ControlRequest): Promise<Outcome<ControlReceipt>>`
  - `JobRepository.applyControl(id: string, request: ControlRequest, at: number): Promise<ControlReceipt>`
  - `JobsService.control()` y `JobsService.retry()` como fachadas de aplicación.

- [ ] T006 [US1] Escribir la prueba fallida — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, src/application/jobs.ts, tests/control.test.mjs`

Probar pausa queued→paused, queue ordinal, resume→queued al final, cancelación queued/paused→cancelled, rechazo de pausa activa, estados inválidos, motivos sobredimensionados y dos operaciones concurrentes con precedencia cancel.

- [ ] T007 [US1] Confirmar el fallo esperado — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, src/application/jobs.ts, tests/control.test.mjs`

Run: `node --test tests/control.test.mjs`
Expected: FAIL porque no existe `ControlService` ni mutación durable de control.

- [ ] T008 [US1] Implementar control atómico — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, src/application/jobs.ts, tests/control.test.mjs`

Canonizar `{ version: 1, operation: "control", jobId, action, actor, reason }`, derivar hash, validar `ControlPolicy` y consultar el ledger dentro del mismo commit. Para queued/paused actualizar job, índice, cola, control history y recibo juntos. Para active persistir `control.pending = "cancel"` y dejar la transición en `cancelling`; `pause` activo falla explícitamente sin mutar.

- [ ] T009 [US1] Confirmar que la prueba pasa — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, src/application/jobs.ts, tests/control.test.mjs`

Run: `node --test tests/control.test.mjs`
Expected: PASS.

- [ ] T010 [US1] Registrar commit autorizado — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, src/application/jobs.ts, tests/control.test.mjs`

```bash
git add src/application/control.ts src/application/jobs.ts src/infrastructure/durable/repository.ts tests/control.test.mjs
git commit -m "feat: add atomic queued lifecycle controls"
```

### Bloque 3: Implementar retry enlazado e idempotente

**Files:**
- Modify: `src/infrastructure/durable/repository.ts`
- Modify: `src/application/control.ts`
- Test: `tests/retry.test.mjs`

**Interfaces:**
- Consumes: `JobRecord` terminal, `ControlRequest`/retry contracts y `CreateId`.
- Produces: `ControlService.retry(id: string, request: RetryRequest): Promise<Outcome<RetryReceipt>>` y `JobRepository.retry(id: string, request: RetryRequest, at: number): Promise<RetryReceipt>`; nuevo job con snapshot de agente, tarea, cwd, modelo y thinking.

- [ ] T011 [US1] Escribir la prueba fallida — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, tests/retry.test.mjs`

Probar retry de completed/failed/interrupted/cancelled, rechazo de queued/running/paused, nuevo ID, `retryOf`, `rootAttemptId`, incremento de intento, revisión según actor, ausencia de resultado/consumo/notificación copiados y replay del mismo request ID.

- [ ] T012 [US1] Confirmar el fallo esperado — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, tests/retry.test.mjs`

Run: `node --test tests/retry.test.mjs`
Expected: FAIL porque el repositorio no crea intentos enlazados.

- [ ] T013 [US1] Implementar retry — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, tests/retry.test.mjs`

Dentro de un commit, leer el terminal original, resolver el ID nuevo, copiar solo el snapshot inmutable y crear el ledger/Job/Review/Index del nuevo job. Mantener el original intacto. Dos request IDs distintos crean dos jobs y el recibo incluye `replayed: false` o `true`.

- [ ] T014 [US1] Confirmar que la prueba pasa — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, tests/retry.test.mjs`

Run: `node --test tests/retry.test.mjs`
Expected: PASS.

- [ ] T015 [US1] Registrar commit autorizado — alcance: `src/infrastructure/durable/repository.ts, src/application/control.ts, tests/retry.test.mjs`

```bash
git add src/application/control.ts src/infrastructure/durable/repository.ts tests/retry.test.mjs
git commit -m "feat: add linked idempotent retries"
```

### Bloque 4: Añadir aborto público y reconciliación del coordinador

**Files:**
- Modify: `src/infrastructure/durable/execution.ts`
- Modify: `src/runtime/coordinator.ts`
- Modify: `src/infrastructure/durable/repository.ts`
- Test: `tests/control-recovery.test.mjs`

**Interfaces:**
- Consumes: `Harness.conversation()`, `Conversation.abort()`, `Harness.abortSubmission()`, `Harness.abortTask()`, `JobRecord.control` y `ControlService`.
- Produces: `DurableExecution.abort(job): Promise<"aborted" | "already_terminal" | "uncertain">`; `Coordinator.reconcileControls(): Promise<void>`; resultados `interrupted` para incertidumbre.

- [ ] T016 [US1] Escribir la prueba fallida — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, src/infrastructure/durable/repository.ts, tests/control-recovery.test.mjs`

Cubrir cancelación en provisioning antes de `submissionId`, cancelación en running, reapertura con `control.pending`, aborto durante herramienta segura/insegura, repetición de la misma intención y que ningún camino use APIs privadas o `force kill`.

- [ ] T017 [US1] Confirmar el fallo esperado — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, src/infrastructure/durable/repository.ts, tests/control-recovery.test.mjs`

Run: `node --test tests/control-recovery.test.mjs`
Expected: FAIL porque el execution driver y el coordinador no reconcilian control.

- [ ] T018 [US1] Implementar reconciliación de aborto — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, src/infrastructure/durable/repository.ts, tests/control-recovery.test.mjs`

Añadir al driver una operación que prefiera `Conversation.abort()` para trabajo activo y `Harness.abortSubmission()` para una submission aún no colocada. El coordinador debe reconciliar antes de admitir más cola, no duplicar submissions, esperar el estado Durable y finalizar `cancelled` solo con confirmación; ante incertidumbre finalizar `interrupted` con detalle durable.

- [ ] T019 [US1] Confirmar que la prueba pasa — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, src/infrastructure/durable/repository.ts, tests/control-recovery.test.mjs`

Run: `node --test tests/control-recovery.test.mjs tests/crash-recovery.test.mjs`
Expected: PASS.

- [ ] T020 [US1] Registrar commit autorizado — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, src/infrastructure/durable/repository.ts, tests/control-recovery.test.mjs`

```bash
git add src/infrastructure/durable/execution.ts src/runtime/coordinator.ts src/infrastructure/durable/repository.ts tests/control-recovery.test.mjs
git commit -m "feat: reconcile cooperative lifecycle cancellation"
```

### Bloque 5: Migrar esquema 3 a esquema 4 y componer runtime

**Files:**
- Modify: `src/infrastructure/storage/inspect.ts`
- Modify: `src/infrastructure/storage/migrate.ts`
- Modify: `src/application/maintenance.ts`
- Modify: `src/runtime/session.ts`
- Create: `tests/helpers/v3.mjs`
- Test: `tests/migration-v3.test.mjs`
- Test: `tests/session-control-runtime.test.mjs`

**Interfaces:**
- Consumes: base esquema 3 de fase 01, backup/autorización TUI y servicios de Tasks 1–4.
- Produces: migración explícita `migrateV3ToV4`, runtime bloqueado hasta esquema 4 y reconciliación de control tras reapertura.

- [ ] T021 [US1] Escribir la prueba fallida — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, src/runtime/session.ts, tests/helpers/v3.mjs, tests/migration-v3.test.mjs, tests/session-control-runtime.test.mjs`

Construir fixtures de esquema 3 con todos los estados, revisión/consumo, resultado grande y jobs sin campos de control. Verificar backup, hash, rechazo/declinación, conservación de documentos y creación de control history/queue ordinal. Probar que esquema 3 exige mantenimiento y esquema 4 es idempotente.

- [ ] T022 [US1] Confirmar el fallo esperado — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, src/runtime/session.ts, tests/helpers/v3.mjs, tests/migration-v3.test.mjs, tests/session-control-runtime.test.mjs`

Run: `node --test tests/migration-v3.test.mjs tests/session-control-runtime.test.mjs`
Expected: FAIL porque el inspector solo admite esquema 2/3 y el runtime no compone control/reconciliación.

- [ ] T023 [US1] Implementar migración y composición runtime — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, src/runtime/session.ts, tests/helpers/v3.mjs, tests/migration-v3.test.mjs, tests/session-control-runtime.test.mjs`

Extender `StorageMeta`/`JobsIndex` a versión 4, validar fuente y backup bajo lease, convertir cada job sin tocar resultado/revisión/consumo, inicializar `queueOrdinal` y documentos de historial, y hacer la conversión atómica. Componer `ControlService` y el coordinador de reconciliación después de abrir esquema 4; una base antigua nunca debe abrir Harness ni proveedor.

- [ ] T024 [US1] Confirmar que la prueba pasa — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, src/runtime/session.ts, tests/helpers/v3.mjs, tests/migration-v3.test.mjs, tests/session-control-runtime.test.mjs`

Run: `node --test tests/migration-v3.test.mjs tests/session-control-runtime.test.mjs tests/migration-v2.test.mjs`
Expected: PASS; migraciones anteriores siguen funcionando y esquema 4 conserva fase 01.

- [ ] T025 [US1] Registrar commit autorizado — alcance: `src/infrastructure/storage/inspect.ts, src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, src/runtime/session.ts, tests/helpers/v3.mjs, tests/migration-v3.test.mjs, tests/session-control-runtime.test.mjs`

```bash
git add src/infrastructure/storage src/application/maintenance.ts src/runtime/session.ts tests/helpers/v3.mjs tests/migration-v3.test.mjs tests/session-control-runtime.test.mjs
git commit -m "feat: migrate lifecycle control storage to schema 4"
```

### Bloque 6: Exponer comandos, tool y autoridad TUI

**Files:**
- Modify: `src/command.ts`
- Modify: `src/adapters/pi/display.ts`
- Modify: `src/adapters/pi/register.ts`
- Test: `tests/pi-control-adapters.test.mjs`
- Test: `tests/command.test.mjs`

**Interfaces:**
- Consumes: `JobsService.control(id: string, request: ControlRequest)`, `JobsService.retry(id: string, request: RetryRequest)`, `canConfirmMigration`, actor del host y errores de Tasks 1–5.
- Produces: comandos `cancel/pause/resume/retry` y tool `pi_agents_control` con `request_id`, `reason` y `--yes`.

- [ ] T026 [US1] Escribir la prueba fallida — alcance: `src/command.ts, src/adapters/pi/display.ts, src/adapters/pi/register.ts, tests/pi-control-adapters.test.mjs, tests/command.test.mjs`

Probar parseo de las cuatro acciones, `--reason`, `--yes`, razón vacía/sobredimensionada, schemas de tool, actor model/human, rechazo headless de cancelación activa y retorno de `PAUSE_ACTIVE_UNSUPPORTED`.

- [ ] T027 [US1] Confirmar el fallo esperado — alcance: `src/command.ts, src/adapters/pi/display.ts, src/adapters/pi/register.ts, tests/pi-control-adapters.test.mjs, tests/command.test.mjs`

Run: `node --test tests/command.test.mjs tests/pi-control-adapters.test.mjs`
Expected: FAIL porque no existen acciones ni tool de control.

- [ ] T028 [US1] Implementar adaptadores — alcance: `src/command.ts, src/adapters/pi/display.ts, src/adapters/pi/register.ts, tests/pi-control-adapters.test.mjs, tests/command.test.mjs`

Delegar a `JobsService`; generar request IDs para comandos, exigir request ID en la tool, comprobar actor/autoridad antes de mutar y usar `ctx.ui.confirm()` para cancelación activa. No permitir que la tool apruebe/rechace ni que el modelo controle jobs humanos bajo la política predeterminada.

- [ ] T029 [US1] Confirmar que la prueba pasa — alcance: `src/command.ts, src/adapters/pi/display.ts, src/adapters/pi/register.ts, tests/pi-control-adapters.test.mjs, tests/command.test.mjs`

Run: `node --test tests/command.test.mjs tests/pi-control-adapters.test.mjs`
Expected: PASS.

- [ ] T030 [US1] Registrar commit autorizado — alcance: `src/command.ts, src/adapters/pi/display.ts, src/adapters/pi/register.ts, tests/pi-control-adapters.test.mjs, tests/command.test.mjs`

```bash
git add src/command.ts src/adapters/pi/display.ts src/adapters/pi/register.ts tests/command.test.mjs tests/pi-control-adapters.test.mjs
git commit -m "feat: expose lifecycle control through Pi"
```

### Bloque 7: Actualizar documentación y matriz de aceptación

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/PHASE-02-ACCEPTANCE.md`
- Modify: `specs/ROADMAP.md`
- Test: `tests/phase-02-acceptance.test.mjs`

**Interfaces:**
- Consumes: contratos, comandos, tool, migración y límites confirmados en Tasks 1–6.
- Produces: documentación de control, pausa no soportada, retry, reconciliación y gates; no modifica comportamiento.

- [ ] T031 [US1] Escribir la prueba fallida — alcance: `docs/ARCHITECTURE.md, docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md, tests/phase-02-acceptance.test.mjs`

Comprobar que la documentación nombra comandos/tool, estados `paused/cancelling/cancelled`, `PAUSE_ACTIVE_UNSUPPORTED`, esquema 3→4, no `force kill`, autoridad TUI y distinción `interrupted`/`cancelled`.

- [ ] T032 [US1] Confirmar el fallo esperado — alcance: `docs/ARCHITECTURE.md, docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md, tests/phase-02-acceptance.test.mjs`

Run: `node --test tests/phase-02-acceptance.test.mjs`
Expected: FAIL porque la documentación aún no describe fase 02 como implementación real.

- [ ] T033 [US1] Actualizar documentación — alcance: `docs/ARCHITECTURE.md, docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md, tests/phase-02-acceptance.test.mjs`

Actualizar README y arquitectura solo con comportamiento implementado. Crear matriz AC-02 con pruebas de transición, carreras, caídas, migración, autoridad e incertidumbre. Mantener fase 02 en `en validación` hasta gates y aceptación TUI.

- [ ] T034 [US1] Confirmar que la prueba pasa — alcance: `docs/ARCHITECTURE.md, docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md, tests/phase-02-acceptance.test.mjs`

Run: `node --test tests/phase-02-acceptance.test.mjs`
Expected: PASS.

- [ ] T035 [US1] Registrar commit autorizado — alcance: `docs/ARCHITECTURE.md, docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md, tests/phase-02-acceptance.test.mjs`

```bash
git add README.md docs/ARCHITECTURE.md docs/PHASE-02-ACCEPTANCE.md specs/ROADMAP.md tests/phase-02-acceptance.test.mjs
git commit -m "docs: document phase 02 lifecycle control"
```

### Bloque 8: Ejecutar gates y aceptación de fase 02

**Files:**
- Modify: `docs/PHASE-02-ACCEPTANCE.md`
- Modify: `specs/ROADMAP.md` solo con evidencia completa.

**Interfaces:**
- Consumes: implementación, migración, pruebas y documentación de Tasks 1–7.
- Produces: evidencia reproducible de fase 02 y estado final `en validación` o `completada`.

- [ ] T036 [US1] Ejecutar verificación completa — alcance: `docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md`

Run:

```bash
npm run check
npm test
PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_phase02_smoke_no_match__
npm pack --dry-run --json
```

Expected: type-check y sintaxis verdes, todas las pruebas verdes, smoke con código 0 y paquete sin SQLite/backups/configuración local.

- [ ] T037 [US1] Revisar evidencia de aceptación — alcance: `docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md`

Comprobar transiciones, carreras, cancelación activa, incertidumbre `interrupted`, retry, reapertura, migración 3→4, autoridad y pausa no soportada. Ejecutar aceptación TUI de cancelación confirmada, pausa queued, resume, retry y migración. No inferir aceptación humana desde pruebas automatizadas.

- [ ] T038 [US1] Registrar commit final autorizado — alcance: `docs/PHASE-02-ACCEPTANCE.md, specs/ROADMAP.md`

```bash
git add docs/PHASE-02-ACCEPTANCE.md specs/ROADMAP.md
git commit -m "test: verify phase 02 lifecycle control"
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
| Bloque 8 | US1 | T036–T038 |

## Implementation Strategy

Ejecutar solo después de confirmar autoridad y el estado actual del trabajo. Verificar el escenario
independiente de cada historia, registrar versiones/comandos/resultados y detenerse ante fallos.
No cerrar fases por marcar casillas ni sustituir revisión independiente o aceptación humana por mocks.

## Notes

Original completo: [archivo histórico](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-07-fase-02-control-ciclo-vida.md).
Las discrepancias de estado se registran en [MIGRATION.md](../MIGRATION.md), no se resuelven
inventando comprobaciones, cambiando casillas o implementando funciones.
