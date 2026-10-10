# Fase 02 — Control durable del ciclo de vida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir cancelación cooperativa, pausa/reanudación de jobs en cola, retry enlazado e historial durable sin fingir pausa activa cuando Pi Durable no la soporta.

**Architecture:** Un `ControlService` será la única autoridad de mutaciones de ciclo de vida para comandos, tools y RPC futuro. Las intenciones se persistirán con el ledger antes de cualquier efecto Durable; el coordinador reconciliará cancelaciones activas mediante `Conversation.abort()`, `Submission.abort()` o `Harness.abortTask()` públicos. La fase introduce esquema 4 con migración explícita desde esquema 3 para conservar compatibilidad, control e historial.

**Tech Stack:** TypeScript estricto, Node.js 26.10.0, `@earendil-works/pi-durable` 1.0.1, Chord, SQLite público `node:sqlite`, Pi 1.0.4 y Node test runner.

**Spec:** `specs/02-control-ciclo-de-vida.md`

## Global Constraints

- Compatibilidad objetivo: macOS arm64, Node `26.10.0`, Pi `1.0.4` y Pi Durable `1.0.1`.
- No instalar dependencias ni modificar declaraciones del host; usar únicamente APIs públicas de Pi Durable.
- Fase 01 debe permanecer funcional y sus resultados, revisión y consumo no deben perderse durante la migración 3→4.
- Toda mutación recibe `requestId`, actor y hash canónico; el ledger Durable es la autoridad de idempotencia.
- La intención de cancelación se persiste antes del aborto externo y se reconcilia con el mismo `requestId` tras reapertura.
- Pausa activa de `provisioning`/`running` devuelve `PAUSE_ACTIVE_UNSUPPORTED`; no se simula con flags.
- `cancel` activo es cooperativo; no se mata el proceso Pi ni se usa una API privada.
- `retry` crea un ID nuevo y nunca reescribe resultado, consumo, revisión o historial terminal del job original.
- TUI es la autoridad para confirmar cancelación activa y para cualquier futura migración; `--yes` es obligatorio en modo no interactivo.
- Motivos tienen un máximo de 2 KiB; el historial embebido tiene un máximo de 64 KiB y después usa documento append-only.

## Review Focus

- **Carrera pause/cancel:** dos commits concurrentes no deben dejar un job pausado después de una cancelación ganadora; lo fijan Tasks 2 y 3.
- **Abort entre provisioning y submission:** una intención persistida antes de guardar `submissionId` debe impedir una ejecución duplicada y reconciliarse tras reapertura; lo fija Task 4.
- **Herramienta insegura durante cancelación:** una terminación incierta debe producir `interrupted`, nunca `cancelled`; lo fijan Tasks 4 y 5.
- **Replay de retry/control:** repetir un `requestId` devuelve el recibo original, mientras dos retries distintos producen intentos distintos; lo fija Task 3.
- **Autoridad del modelo:** un modelo no puede controlar por defecto un job humano ni confirmar una operación TUI; lo fija Task 6.

## Mapa de archivos

- `src/domain/jobs.ts`, `src/domain/requests.ts`, `src/domain/errors.ts`: estados, control, retry, recibos y errores.
- `src/infrastructure/durable/documents.ts`, `repository.ts`: esquema 4, historial, ledger y commits atómicos.
- `src/infrastructure/storage/inspect.ts`, `migrate.ts`, `application/maintenance.ts`: inspección y migración 3→4.
- `src/application/control.ts`, `application/jobs.ts`: autorización, transiciones y composición del caso de uso.
- `src/infrastructure/durable/execution.ts`, `src/runtime/coordinator.ts`, `src/runtime/session.ts`: aborto público y reconciliación tras reapertura.
- `src/command.ts`, `src/adapters/pi/display.ts`, `src/adapters/pi/register.ts`: comandos, tool, confirmación TUI y presentación.
- `tests/control-contracts.test.mjs`, `tests/control.test.mjs`, `tests/control-recovery.test.mjs`, `tests/retry.test.mjs`, `tests/migration-v3.test.mjs`, `tests/pi-control-adapters.test.mjs`, `tests/phase-02-acceptance.test.mjs`: pruebas unitarias, integración y aceptación.
- `README.md`, `docs/ARCHITECTURE.md`, `docs/PHASE-02-ACCEPTANCE.md`, `specs/ROADMAP.md`: documentación y gates.

---

### Task 1: Extender contratos y documentos al control durable

**Files:**
- Modify: `src/domain/jobs.ts`
- Modify: `src/domain/requests.ts`
- Modify: `src/domain/errors.ts`
- Modify: `src/infrastructure/durable/documents.ts`
- Test: `tests/control-contracts.test.mjs`

**Interfaces:**
- Consumes: `JobRecord`, `Actor`, `RequestRecord`, estado y documentos de fase 01.
- Produces: `JobStatus` con `paused`/`cancelling`/`cancelled`; `ControlAction`; `ControlRequest = { requestId: string; action: ControlAction; actor: Actor; reason?: string }`; `RetryRequest = Omit<ControlRequest, "action"> & { action: "retry" }`; `ControlReceipt`; `RetryReceipt`; `ControlEvent`; `ControlPolicy`; `JobControlDocument = { events: ControlEvent[] }`; errores `PAUSE_ACTIVE_UNSUPPORTED`, `CONTROL_INVALID_STATE`, `CONTROL_NOT_AUTHORIZED`, `CONTROL_CONFLICT` y `RETRY_NOT_ALLOWED`.

- [ ] **Step 1: Write the failing test**

Comprobar estados públicos, acciones válidas, motivos de 2 KiB, recibos con estado anterior/resultante/replay, campos `retryOf`/`attemptNumber`/`rootAttemptId`, y que los documentos nuevos usan semillas deterministas.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/control-contracts.test.mjs`
Expected: FAIL porque los estados, tipos, documentos y errores nuevos no existen.

- [ ] **Step 3: Implement the minimal contracts**

Extender `JobRecord` con `control`, `retryOf`, `attemptNumber`, `rootAttemptId`, `queueOrdinal` y `controlHistory` limitado. Definir `JobControlDocFamily` para historial append-only y mantener los resultados/consumos separados. Actualizar validadores y `transition()` sin permitir reanudar terminales.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/control-contracts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain src/infrastructure/durable/documents.ts tests/control-contracts.test.mjs
git commit -m "feat: define durable lifecycle control contracts"
```

### Task 2: Implementar mutaciones atómicas de cola y control

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

- [ ] **Step 1: Write the failing test**

Probar pausa queued→paused, queue ordinal, resume→queued al final, cancelación queued/paused→cancelled, rechazo de pausa activa, estados inválidos, motivos sobredimensionados y dos operaciones concurrentes con precedencia cancel.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/control.test.mjs`
Expected: FAIL porque no existe `ControlService` ni mutación durable de control.

- [ ] **Step 3: Implement atomic control**

Canonizar `{ version: 1, operation: "control", jobId, action, actor, reason }`, derivar hash, validar `ControlPolicy` y consultar el ledger dentro del mismo commit. Para queued/paused actualizar job, índice, cola, control history y recibo juntos. Para active persistir `control.pending = "cancel"` y dejar la transición en `cancelling`; `pause` activo falla explícitamente sin mutar.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/control.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/control.ts src/application/jobs.ts src/infrastructure/durable/repository.ts tests/control.test.mjs
git commit -m "feat: add atomic queued lifecycle controls"
```

### Task 3: Implementar retry enlazado e idempotente

**Files:**
- Modify: `src/infrastructure/durable/repository.ts`
- Modify: `src/application/control.ts`
- Test: `tests/retry.test.mjs`

**Interfaces:**
- Consumes: `JobRecord` terminal, `ControlRequest`/retry contracts y `CreateId`.
- Produces: `ControlService.retry(id: string, request: RetryRequest): Promise<Outcome<RetryReceipt>>` y `JobRepository.retry(id: string, request: RetryRequest, at: number): Promise<RetryReceipt>`; nuevo job con snapshot de agente, tarea, cwd, modelo y thinking.

- [ ] **Step 1: Write the failing test**

Probar retry de completed/failed/interrupted/cancelled, rechazo de queued/running/paused, nuevo ID, `retryOf`, `rootAttemptId`, incremento de intento, revisión según actor, ausencia de resultado/consumo/notificación copiados y replay del mismo request ID.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/retry.test.mjs`
Expected: FAIL porque el repositorio no crea intentos enlazados.

- [ ] **Step 3: Implement retry**

Dentro de un commit, leer el terminal original, resolver el ID nuevo, copiar solo el snapshot inmutable y crear el ledger/Job/Review/Index del nuevo job. Mantener el original intacto. Dos request IDs distintos crean dos jobs y el recibo incluye `replayed: false` o `true`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/retry.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/application/control.ts src/infrastructure/durable/repository.ts tests/retry.test.mjs
git commit -m "feat: add linked idempotent retries"
```

### Task 4: Añadir aborto público y reconciliación del coordinador

**Files:**
- Modify: `src/infrastructure/durable/execution.ts`
- Modify: `src/runtime/coordinator.ts`
- Modify: `src/infrastructure/durable/repository.ts`
- Test: `tests/control-recovery.test.mjs`

**Interfaces:**
- Consumes: `Harness.conversation()`, `Conversation.abort()`, `Harness.abortSubmission()`, `Harness.abortTask()`, `JobRecord.control` y `ControlService`.
- Produces: `DurableExecution.abort(job): Promise<"aborted" | "already_terminal" | "uncertain">`; `Coordinator.reconcileControls(): Promise<void>`; resultados `interrupted` para incertidumbre.

- [ ] **Step 1: Write the failing test**

Cubrir cancelación en provisioning antes de `submissionId`, cancelación en running, reapertura con `control.pending`, aborto durante herramienta segura/insegura, repetición de la misma intención y que ningún camino use APIs privadas o `force kill`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/control-recovery.test.mjs`
Expected: FAIL porque el execution driver y el coordinador no reconcilian control.

- [ ] **Step 3: Implement public abort reconciliation**

Añadir al driver una operación que prefiera `Conversation.abort()` para trabajo activo y `Harness.abortSubmission()` para una submission aún no colocada. El coordinador debe reconciliar antes de admitir más cola, no duplicar submissions, esperar el estado Durable y finalizar `cancelled` solo con confirmación; ante incertidumbre finalizar `interrupted` con detalle durable.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/control-recovery.test.mjs tests/crash-recovery.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/durable/execution.ts src/runtime/coordinator.ts src/infrastructure/durable/repository.ts tests/control-recovery.test.mjs
git commit -m "feat: reconcile cooperative lifecycle cancellation"
```

### Task 5: Migrar esquema 3 a esquema 4 y componer runtime

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

- [ ] **Step 1: Write the failing test**

Construir fixtures de esquema 3 con todos los estados, revisión/consumo, resultado grande y jobs sin campos de control. Verificar backup, hash, rechazo/declinación, conservación de documentos y creación de control history/queue ordinal. Probar que esquema 3 exige mantenimiento y esquema 4 es idempotente.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/migration-v3.test.mjs tests/session-control-runtime.test.mjs`
Expected: FAIL porque el inspector solo admite esquema 2/3 y el runtime no compone control/reconciliación.

- [ ] **Step 3: Implement migration and runtime composition**

Extender `StorageMeta`/`JobsIndex` a versión 4, validar fuente y backup bajo lease, convertir cada job sin tocar resultado/revisión/consumo, inicializar `queueOrdinal` y documentos de historial, y hacer la conversión atómica. Componer `ControlService` y el coordinador de reconciliación después de abrir esquema 4; una base antigua nunca debe abrir Harness ni proveedor.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/migration-v3.test.mjs tests/session-control-runtime.test.mjs tests/migration-v2.test.mjs`
Expected: PASS; migraciones anteriores siguen funcionando y esquema 4 conserva fase 01.

- [ ] **Step 5: Commit**

```bash
git add src/infrastructure/storage src/application/maintenance.ts src/runtime/session.ts tests/helpers/v3.mjs tests/migration-v3.test.mjs tests/session-control-runtime.test.mjs
git commit -m "feat: migrate lifecycle control storage to schema 4"
```

### Task 6: Exponer comandos, tool y autoridad TUI

**Files:**
- Modify: `src/command.ts`
- Modify: `src/adapters/pi/display.ts`
- Modify: `src/adapters/pi/register.ts`
- Test: `tests/pi-control-adapters.test.mjs`
- Test: `tests/command.test.mjs`

**Interfaces:**
- Consumes: `JobsService.control(id: string, request: ControlRequest)`, `JobsService.retry(id: string, request: RetryRequest)`, `canConfirmMigration`, actor del host y errores de Tasks 1–5.
- Produces: comandos `cancel/pause/resume/retry` y tool `pi_agents_control` con `request_id`, `reason` y `--yes`.

- [ ] **Step 1: Write the failing test**

Probar parseo de las cuatro acciones, `--reason`, `--yes`, razón vacía/sobredimensionada, schemas de tool, actor model/human, rechazo headless de cancelación activa y retorno de `PAUSE_ACTIVE_UNSUPPORTED`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/command.test.mjs tests/pi-control-adapters.test.mjs`
Expected: FAIL porque no existen acciones ni tool de control.

- [ ] **Step 3: Implement adapters**

Delegar a `JobsService`; generar request IDs para comandos, exigir request ID en la tool, comprobar actor/autoridad antes de mutar y usar `ctx.ui.confirm()` para cancelación activa. No permitir que la tool apruebe/rechace ni que el modelo controle jobs humanos bajo la política predeterminada.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/command.test.mjs tests/pi-control-adapters.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/command.ts src/adapters/pi/display.ts src/adapters/pi/register.ts tests/command.test.mjs tests/pi-control-adapters.test.mjs
git commit -m "feat: expose lifecycle control through Pi"
```

### Task 7: Actualizar documentación y matriz de aceptación

**Files:**
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Create: `docs/PHASE-02-ACCEPTANCE.md`
- Modify: `specs/ROADMAP.md`
- Test: `tests/phase-02-acceptance.test.mjs`

**Interfaces:**
- Consumes: contratos, comandos, tool, migración y límites confirmados en Tasks 1–6.
- Produces: documentación de control, pausa no soportada, retry, reconciliación y gates; no modifica comportamiento.

- [ ] **Step 1: Write the failing test**

Comprobar que la documentación nombra comandos/tool, estados `paused/cancelling/cancelled`, `PAUSE_ACTIVE_UNSUPPORTED`, esquema 3→4, no `force kill`, autoridad TUI y distinción `interrupted`/`cancelled`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/phase-02-acceptance.test.mjs`
Expected: FAIL porque la documentación aún no describe fase 02 como implementación real.

- [ ] **Step 3: Update documentation**

Actualizar README y arquitectura solo con comportamiento implementado. Crear matriz AC-02 con pruebas de transición, carreras, caídas, migración, autoridad e incertidumbre. Mantener fase 02 en `en validación` hasta gates y aceptación TUI.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/phase-02-acceptance.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/ARCHITECTURE.md docs/PHASE-02-ACCEPTANCE.md specs/ROADMAP.md tests/phase-02-acceptance.test.mjs
git commit -m "docs: document phase 02 lifecycle control"
```

### Task 8: Ejecutar gates y aceptación de fase 02

**Files:**
- Modify: `docs/PHASE-02-ACCEPTANCE.md`
- Modify: `specs/ROADMAP.md` solo con evidencia completa.

**Interfaces:**
- Consumes: implementación, migración, pruebas y documentación de Tasks 1–7.
- Produces: evidencia reproducible de fase 02 y estado final `en validación` o `completada`.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run check
npm test
PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_phase02_smoke_no_match__
npm pack --dry-run --json
```

Expected: type-check y sintaxis verdes, todas las pruebas verdes, smoke con código 0 y paquete sin SQLite/backups/configuración local.

- [ ] **Step 2: Review acceptance evidence**

Comprobar transiciones, carreras, cancelación activa, incertidumbre `interrupted`, retry, reapertura, migración 3→4, autoridad y pausa no soportada. Ejecutar aceptación TUI de cancelación confirmada, pausa queued, resume, retry y migración. No inferir aceptación humana desde pruebas automatizadas.

- [ ] **Step 3: Commit final**

```bash
git add docs/PHASE-02-ACCEPTANCE.md specs/ROADMAP.md
git commit -m "test: verify phase 02 lifecycle control"
```

## Plan self-review

- **Cobertura de spec:** RF-01 → Tasks 1–2/6; RF-02 → Task 2; RF-03 → Task 2/6; RF-04 → Task 4; RF-05 → Task 2; RF-06 → Task 3; RF-07 → Task 2; interfaces → Task 6; migración/reapertura → Task 5; pruebas y documentación → Tasks 7–8.
- **Consistencia de tipos:** `ControlRequest`, `ControlReceipt`, `RetryRequest` y `RetryReceipt` nacen en Task 1; repository, service, coordinator y adapters los consumen sin redefinirlos.
- **Autoridad:** la tool usa actor model y queda limitada por política; comandos y migración usan actor human/TUI; no existe `force kill`.
- **Carreras:** pause/cancel, retry/retry, cancelación antes de `submissionId` y replay de ledger tienen pruebas propietarias.
- **Reconciliación:** cada ventana de caída tiene una prueba en Task 4 o Task 5; `requestId` evita repetir efectos externos.
- **Limitación declarada:** la pausa activa no se implementa hasta que exista una API pública; el plan la prueba como error explícito.
- **Proporción:** ocho tareas separan contratos, persistencia, ejecución, migración, adaptadores y gates; cada una termina con prueba y commit independiente.
