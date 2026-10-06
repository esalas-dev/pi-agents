# Fase 00 — Preparación arquitectónica: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar la base de `pi-agents` conservando sus entradas públicas, con almacenamiento separado, migración humana, inicio idempotente y recuperación verificable.

**Architecture:** Separar adaptadores Pi, aplicación, dominio, infraestructura Durable y runtime por sesión. Mantener un SQLite por sesión y actualizar documentos relacionados en un único commit Durable. Construir y probar componentes antes de sustituir el coordinador actual; no conservar `JobManager` como fachada definitiva.

**Tech Stack:** macOS arm64; Node 26.10.0; Pi 1.0.4; Pi Durable 1.0.1; Chord 1.0.1; YAML 2.9.0; TypeScript 5.9.3; @types/node 26.6.4; node:test y node:sqlite.

**Spec:** [`specs/00-preparacion-arquitectonica.md`](../../../specs/00-preparacion-arquitectonica.md), aprobada por el usuario después del commit `c6fc78b`. Leer spec y plan completos antes de ejecutar.

## Global Constraints

- «Un SQLite por sesión, con documentos separados y transacciones comunes.»
- «Migración explícita por base, autorizada por humano y precedida por backup consistente.»
- «Compatibilidad inicial limitada al entorno inspeccionado, no a todos los mínimos históricos.»
- «Actores atribuidos por adaptadores; ningún argumento de tool concede identidad humana.»
- «Deduplicación del inicio por identidad de solicitud, sin añadir parámetros a la tool existente.»
- «El ledger no guarda cuerpos de resultados ni se purga automáticamente.»
- «No se añaden a `dependencies` ni se empaquetan copias directas»: aplica a paquetes suministrados por Pi; inventariar las dependencias transitivas de Durable.
- «El nuevo mínimo Node será `26.10.0`, sin equiparar ese rango a una matriz probada.»
- «No hay migración por lotes en esta fase.» No usar SQL propio para mutar tablas internas de Durable.
- Conservar `/pi-agents <agente> <tarea>`, `status`, `result` y `pi_agents({ agent, task })`; añadir únicamente `/pi-agents-storage migrate`.
- No implementar fases 01–10, promoción, autoaprobación, purga, downgrade directo ni APIs privadas.
- No abrir SQLite reales del usuario durante pruebas; usar fixtures sintéticas, proveedor faux y directorios temporales.

## Review Focus

1. Cambio de sesión mientras está abierto el diálogo de migración: no aplicar una autorización a otra sesión ni reabrir contexto invalidado; prueba en tarea 10.
2. Dos representaciones de la misma ruta o symlink de base/lock/backup: no eludir propiedad ni sobrescribir un destino; pruebas en tarea 6.
3. IDs y claves de diccionario como `__proto__` o `constructor`: tratarlos como datos, sin falsear existencia ni contaminar prototipos; pruebas en tareas 3–4.
4. Disco lleno, backup cortado o excepción de apertura: conservar fuente y liberar solo los recursos realmente propios; pruebas en tareas 6–7 y 9.
5. Timeout/fallo del canal de notificación después del commit terminal: no cambiar el resultado técnico ni volver a ejecutar el job; pruebas en tareas 9–10.

---

## Estado, orden y gates

Plan aprobado; ejecución nativa elegida por el usuario. Las casillas se actualizarán solo con evidencia. El baseline de código es `efc690f`; `c6fc78b` añade el diseño. La implementación empieza solo tras revisión del plan y elección de ejecución. Crear aislamiento en ese momento siguiendo `using-git-worktrees`, no durante esta planificación.

Orden obligatorio de este plan: tareas 1 → 11. Una tarea no pasa al siguiente gate si sus pruebas fallan. Durante tarea 2 aparecieron 44 errores de declaraciones upstream. El usuario autorizó `skipLibCheck: true`; se mantiene `strict` en código propio y comprobación del uso de declaraciones. Cualquier incompatibilidad restante entre `pi-ai` local 1.0.1 y host 1.0.4 requiere decisión explícita, no cast doble, `any` ni actualización silenciosa de pins.

Cada commit debe incluir solo archivos de su tarea. Ejecutar `npm test` y, desde tarea 2, `npm run check` antes de cada commit. Si la tarea revela una contradicción de diseño, detenerse y revisar la spec, no ampliar el alcance por iniciativa propia.

## Mapa de archivos objetivo

| Archivos | Responsabilidad |
| --- | --- |
| `index.ts` | Composición y registro de extensión. |
| `src/agents.ts`, `src/command.ts` | Descubrimiento y parser actuales; conservar salvo ajustes de tipos imprescindibles. |
| `src/domain/jobs.ts`, `errors.ts`, `requests.ts` | Tipos/estados, errores y canonización. |
| `src/application/start.ts`, `jobs.ts`, `maintenance.ts` | Admisión, consultas actuales y mantenimiento autorizado. |
| `src/infrastructure/durable/documents.ts`, `repository.ts`, `execution.ts`, `legacy-v1.ts` | Documentos, atomicidad, conversaciones y lectura v1. |
| `src/infrastructure/storage/lease.ts`, `inspect.ts`, `backup.ts`, `migrate.ts` | Propiedad, detección, backup y conversión. |
| `src/runtime/session.ts`, `coordinator.ts` | Recursos de sesión y coordinación de slots/monitores. |
| `src/adapters/pi/resolve.ts`, `display.ts`, `register.ts` | Resolución del contexto, presentación y entradas Pi. |
| `scripts/host-types.mjs`, `scripts/check-syntax.mjs` | Type-check con host instalado y sintaxis de todos los `.ts` productivos. |
| `tsconfig.json`, `.cache/pi-agents/tsconfig.host.json` | Base versionada y configuración local generada/ignorada. |
| `tests/helpers/`, `tests/fixtures/v1/`, `tests/*.test.mjs` | Fixtures congeladas, integración, instrumentación y caídas. |
| `docs/PHASE-00-ACCEPTANCE.md` | Evidencia real de aceptación y limitaciones; no rellenar como éxito anticipado. |

Eliminar `src/jobs.ts` solo en la tarea 10, después de portar sus pruebas. No crear directorios vacíos ni APIs futuras. Los archivos enumerados son propuestas, no archivos ya existentes.

## Contratos comunes del plan

Los tipos se definen en la tarea indicada; las demás tareas los importan, no los redefinen.

- `JobStatus = "queued"|"provisioning"|"running"|"completed"|"failed"|"interrupted"`; `JobStatusPublic = Exclude<JobStatus,"provisioning">` (tarea 3). Salvo firma distinta, IDs de jobs son `string`, IDs Durable y timestamps son `number`.
- `Actor = { kind: "human" | "model" | "extension" | "system"; id?: string }` (tarea 3).
- `StartIntent = { agent: string; task: string; cwd: string }`; `StartRequest = { requestId: string; actor: Actor; intent: StartIntent }` (3).
- `ResolvedJobInput`: los cinco campos actuales de `StartJobInput`: `task`, `cwd`, `agent: JobAgentSnapshot`, `model: JobModel`, `thinkingLevel` (3).
- `JobRecord`: campos actuales salvo `result`; añade `createdBy?: Actor` y `resultMeta?: Omit<JobResult, "finalResponse">` (3). `JobResult`, `JobModel` y `JobAgentSnapshot` conservan sus campos del baseline.
- `AdmissionReceipt = { jobId: string; status: "queued"; agent: string }`; siempre es recibo histórico de admisión, no estado actual (3).
- `RequestRecord = { requestId: string; operation: string; actor: Actor; canonicalVersion: 1; payloadHash: string; admittedAt: number; response: AdmissionReceipt }` (3).
- `Outcome<T> = { success: true; value: T } | { success: false; error: AppError }`; `AppError = { code: ErrorCode; message: string; retryable: boolean; details: Record<string, unknown> }` (3). Solo valores JSON seguros pueden salir al adaptador.
- `ResolveInput = (intent: StartIntent) => Promise<ResolvedJobInput>`; `Clock = () => number`; `CreateId = () => string` (3).
- `JobView = { job: Readonly<JobRecord>; queuePosition?: number }`; `ResultView = JobView & { result?: Readonly<JobResult> }` (3).
- `Lease = { dbPath: string; token: string; release(): Promise<void> }` (6); nunca transferir responsabilidad de cierre implícitamente.
- `StorageInspection = { kind: "empty" } | { kind: "legacy-v1"; jobs: number; sourceHash: string } | { kind: "current"; schemaVersion: 2 }` (6). Desconocido/inconsistente produce error, no otro estado utilizable.
- `BackupReceipt = { path: string; sha256: string; createdAt: number }` (6).
- `MigrationApproval = { requestId: string; actor: Actor & { kind: "human" }; dbPath: string; sourceHash: string; approvedAt: number }` (7). La procedencia humana se verifica en el adaptador, no por aceptar este objeto desde un modelo.

## Task 1 — Congelar v1 y caracterizar el contrato existente

**Files:** crear `tests/fixtures/v1/jobs-v1.ts`, `tests/fixtures/v1/README.md`, `tests/helpers/legacy.mjs`, `tests/legacy-fixtures.test.mjs`; modificar `tests/jobs.test.mjs` y `tests/recovery.test.mjs` solo para reutilizar helpers sin debilitar aserciones.

**Interfaces:** consume `JobManager`/`JobsDoc` del baseline. Produce `createLegacyFixture({ directory, scenario }): Promise<{ database: string; expected: object }>` en `tests/helpers/legacy.mjs`; escenarios `queued`, `provisioning`, `running`, `terminal-mix`, `large-result`. Produce `legacyInput(task): ResolvedJobInput` por forma estructural, sin importar tipos nuevos.

- [x] **1. Escribir caracterización y prueba de fixture.** Congelar el contenido exacto de `src/jobs.ts` del commit `efc690f` en `jobs-v1.ts`, con procedencia/hash en README; la prueba no depende del migrador nuevo. Crear bases con APIs públicas y faux; para estados activos usar conversaciones/submissions reales y scheduler detenido o barreras.

```js
const f = await createLegacyFixture({ directory, scenario: 'terminal-mix' });
assert.deepEqual(await readLegacy(f.database), f.expected);
assert.equal(f.expected.jobs.psa_done.notified, false);
assert.equal(f.expected.jobs.psa_interrupted.result.status, 'interrupted');
```

`readLegacy(database): Promise<JobsStateV1>` pertenece al helper; cierra todos los handles. `psa_interrupted` es un caso sintético válido, no una ruta de ejecución inventada. `large-result` usa `'x'.repeat(1024 * 1024)`.

- [x] **2. Ejecutar RED:** `node --test tests/legacy-fixtures.test.mjs`; debe fallar por helper/fixture ausente, no por credenciales o red.
- [x] **3. Implementar helper y fixtures reproducibles.** Cubrir orden de cola, flags de notificación, IDs de conversación/submission, timestamps y cadena de resultado. No guardar bases de usuario ni regenerar definiciones v1 desde esquema 2.
- [x] **4. Ejecutar GREEN:** `node --test tests/legacy-fixtures.test.mjs tests/jobs.test.mjs tests/recovery.test.mjs`; luego `npm test`. Pasan casos nuevos y las nueve pruebas originales.
- [x] **5. Commit:** archivos listados, mensaje `test: freeze v1 storage fixtures and baseline behavior`.

## Task 2 — Type-check real y grafo de módulos comprobable

**Files:** crear `tsconfig.json`, `scripts/host-types.mjs`, `scripts/check-syntax.mjs`, `tests/typecheck.test.mjs`, `tests/host-resolution.test.mjs`; modificar `.gitignore`, `package.json`, `package-lock.json`, `README.md` y anotaciones productivas que `tsc` demuestre incorrectas.

**Interfaces:** `resolveHost({ packageRoot? }): Promise<{ root: string; version: string; declarations: Record<string,string> }>` y `generateHostConfig({ root, outFile }): Promise<void>` en `host-types.mjs`. Override `PI_AGENTS_PI_PACKAGE_ROOT`; si falta, localizar binario `pi` en PATH y resolver su raíz real, sin ruta Homebrew hardcodeada. Resolver exports públicos bajo condiciones `types`/`import`, incluidos subpaths; no asumir `require.resolve` CJS para un paquete ESM.

- [x] **1. Escribir pruebas de resolución y rechazo de tipos.** Ejecutar el compilador en subprocess con un fixture temporal deliberadamente incorrecto:

```js
assert.notEqual(await typecheckSource('const count: number = "wrong";'), 0);
assert.equal(await typecheckSource('const count: number = 1;'), 0);
assert.match((await resolveHost({ packageRoot: realHost })).version, /^1\.0\.4$/);
await assert.rejects(resolveHost({ packageRoot: missingHost }), /Pi/);
```

`typecheckSource(source): Promise<number>` es helper de `tests/typecheck.test.mjs`, con cleanup temporal. Probar un subpath público de `pi-ai` y registrar raíz/versiones local y host sin fingir identidad de instancia.

- [x] **2. RED:** `node --test tests/typecheck.test.mjs tests/host-resolution.test.mjs`; falta tooling o falla detección controlada.
- [x] **3. Instalar solo herramientas de desarrollo autorizadas por este plan:** `npm install --save-dev --save-exact --omit=peer typescript@5.9.3 @types/node@26.6.4`. Versiones consultadas en npm durante planificación; no se instalaron al escribirlo. Revisar el diff del lockfile y no aceptar actualización colateral de pins.
- [x] **4. Implementar configuración.** `strict: true`, `noEmit: true`, `target: "ES2022"`, `module`/`moduleResolution: "NodeNext"`, `allowImportingTsExtensions: true`, `skipLibCheck: true` (excepción aprobada por el usuario durante ejecución: validar código propio y uso de tipos, no los cuerpos de `.d.ts` externos); incluir `index.ts` y `src/**/*.ts`. Generar `.cache/pi-agents/tsconfig.host.json` con paths absolutos locales, nunca versionarlos. Dependencias host siguen como peers `*`.
- [x] **5. Integrar scripts.** `check:types` genera config y ejecuta `tsc --noEmit -p .cache/pi-agents/tsconfig.host.json`; `check:syntax` recorre `index.ts` y todos los `.ts` de `src`; `check` encadena ambos. Actualizar `engines.node` a `>=26.10.0` y explicar la matriz limitada. Corregir tipos productivos con API pública; si falla una declaración incompatible del grafo externo, detener el gate, no silenciarla.
- [x] **6. GREEN:** `npm run check && npm test`. Registrar `pi-ai` local 1.0.1 y host 1.0.4. No concluir compatibilidad runtime hasta tareas 10–11.
- [x] **7. Commit:** `build: add strict host-aware TypeScript checks`.

## Task 3 — Contratos de dominio, errores y canonización

**Files:** crear `src/domain/jobs.ts`, `src/domain/errors.ts`, `src/domain/requests.ts`, `tests/domain.test.mjs`.

**Interfaces:** produce tipos de la sección común; `publicStatus(job: Pick<JobRecord,"status">): JobStatusPublic`; `transition(job: JobRecord, next: JobStatus, at: number): JobRecord` (nuevo objeto, transición inválida falla); `canonicalStart(request: StartRequest): { normalized: StartRequest; payloadHash: string; key: string }`; `DomainError extends Error` con `error: AppError`; `failure(error: unknown): Outcome<never>`.

- [x] **1. Escribir tabla de transiciones y canonización.** Permitir queued→provisioning, provisioning→running y fallo desde cualquier no terminal; running→completed; terminales inmutables. No introducir producción de `interrupted` nueva. Validar números finitos, estados y herramientas sin depender de Durable.

```js
assert.equal(publicStatus({ status: 'provisioning' }), 'running');
assert.equal(canonicalStart(a).payloadHash, canonicalStart(reorderedA).payloadHash);
assert.notEqual(canonicalStart(a).payloadHash, canonicalStart(changedActor).payloadHash);
assert.throws(() => canonicalStart({ ...a, requestId: '' }), DomainError);
assert.equal(Object.hasOwn(JSON.parse('{"__proto__":1}'), '__proto__'), true);
```

Los últimos datos alimentan además casos de diccionario de tarea 4; no rechazar un ID solo por coincidir con propiedad del prototipo. Fijar tarea con trim exterior, espacios interiores conservados, agente sensible a mayúsculas, cwd absoluto normalizado y actor id ausente omitido, nunca `undefined` serializado.

- [x] **2. RED:** `node --test tests/domain.test.mjs`.
- [x] **3. Implementar contratos puros.** Thinking: `off|minimal|low|medium|high|xhigh|max`. Códigos de error exactamente los de la spec; detalles de error público JSON seguros. Hash SHA-256 de JSON canónico UTF-8 con claves ordenadas; la clave de ledger es SHA-256 de requestId completo. Ningún import de Pi/TUI/SQLite en dominio.
- [x] **4. GREEN:** `node --test tests/domain.test.mjs && npm run check && npm test`.
- [x] **5. Commit:** `refactor: define job domain and request contracts`.

## Task 4 — Documentos separados y repositorio transaccional

**Files:** crear `src/infrastructure/durable/documents.ts`, `src/infrastructure/durable/repository.ts`, `tests/helpers/store.mjs`, `tests/repository.test.mjs`.

**Interfaces:** tokens/kinds/versiones de la spec; `createJobRepository(session: Session, context: Context, clock: Clock, createId: CreateId): JobRepository`. `JobRepository` expone `get(id: string): Promise<JobRecord|undefined>`, `result(id: string): Promise<JobResult|undefined>`, `queuedPosition(id: string): Promise<number|undefined>`, `active(): Promise<JobRecord[]>`, `unnotified(): Promise<JobRecord[]>`, `markNotified(id: string): Promise<void>`, `finish(id: string,result: JobResult,at: number): Promise<void>`, `markRunning(id: string,submissionId: number,at: number): Promise<void>` y `claimNext(maxConcurrency: number, createConversation: CreateConversation): Promise<JobRecord|undefined>`. El callback infra `CreateConversation` es `(tx: Tx, job: JobRecord) => Promise<number>`; no se expone a dominio/adaptadores Pi.

`tests/helpers/store.mjs` produce `makeStoreFixture(): Promise<{ session, repository, close, reopen, readKinds, seedJob }>`; `seedJob(job,result?)` es exclusivamente helper de prueba.

- [x] **1. Escribir pruebas atómicas y de lectura diferida.** Instrumentar el `Storage` público para registrar `document`/`findDocument` y mapear IDs a kinds, sin tocar internals. Vaciar registro antes de cada consulta.

```js
await f.seedJob(doneJob, { ...result, finalResponse: 'x'.repeat(1024 * 1024) });
await f.reopen(); // nueva Session: el cache no debe ocultar lecturas de cuerpos
f.readKinds.length = 0;
await f.repository.get(doneJob.id);
assert.ok(!f.readKinds.includes('pi-agents.job-result'));
assert.equal((await f.repository.result(doneJob.id)).finalResponse.length, 1024 * 1024);
assert.equal(await f.repository.get('missing'), undefined);
```

Afirmar que lecturas ausentes no crean miembros. Probar jobs con ID `__proto__`/`constructor`, cola sin duplicados y fallo de commit sin publicación parcial. Preparar en `seedJob` registros consistentes, no llamar a admisión futura.

- [x] **2. RED:** `node --test tests/repository.test.mjs`.
- [x] **3. Implementar documentos.** Esquema global 2, tokens individuales v1. Familias job/result con seed real al crear y seed `null` al exigir existencia; `initial(null)` lanza `STORAGE_INCONSISTENT`, nunca fabrica un job. `get`/`result` usan `snapshot`, no `tx.doc`. Ledger tendrá celda `{ record: RequestRecord|null }`; `null` solo puede existir durante una admisión aún no confirmada (tarea 5).
- [x] **4. Implementar operaciones del repositorio.** Índice compacto sin tareas, prompts, respuestas ni errores grandes; metadatos de resultado en job. `claimNext` comprueba slots dentro del commit y ejecuta el callback de creación/configuración en ese mismo commit; si falla, no consumir cola ni publicar conversación. `finish` es condicional e inmutable después de terminal; `markNotified` repetido no altera timestamps otra vez.
- [x] **5. GREEN:** `node --test tests/repository.test.mjs && npm run check && npm test`. Comprobar queue/job/result/index juntos mediante reapertura.
- [x] **6. Commit:** `feat: add partitioned durable job repository`.

## Task 5 — Admisión idempotente y servicios de consulta actuales

**Files:** crear `src/application/start.ts`, `src/application/jobs.ts`, `tests/start-service.test.mjs`; ampliar `repository.ts` y `tests/helpers/store.mjs`.

**Interfaces:** repositorio añade `receipt(requestId: string): Promise<RequestRecord|undefined>` y `admit(request: StartRequest, input: ResolvedJobInput): Promise<AdmissionReceipt>`. `createStartService(repository: JobRepository, wake: () => void, report: (error: unknown) => void): StartService` produce `start(request: StartRequest, resolve: ResolveInput): Promise<Outcome<AdmissionReceipt>>` y `seal(): void`; tras sellar, nuevas llamadas devuelven `RUNTIME_CLOSING`. `createJobsService(repository,startService): JobsService` expone `start` anterior, `status(id): Promise<Outcome<JobView>>`, `result(id): Promise<Outcome<ResultView>>`, `markNotified(id): Promise<Outcome<void>>` y `unnotified(): Promise<Outcome<JobRecord[]>>`.

- [x] **1. Escribir pruebas de replay, conflicto y consulta.** Preparar `resolve` faux que cuenta invocaciones y devuelve `legacyInput`; no iniciar scheduler.

```js
const one = await service.start(request, resolve);
const again = await service.start(request, () => { throw Error('config changed'); });
assert.deepEqual(again, one);
assert.equal(resolveCalls, 1);
assert.equal((await service.start(changedPayloadSameId, resolve)).error.code, 'REQUEST_ID_CONFLICT');
assert.equal((await jobs.status('missing')).error.code, 'JOB_NOT_FOUND');
```

Añadir `Promise.all` de dos admisiones iguales, reapertura y replay; cambiar actor debe confligir. Para operación distinta, sembrar un recibo con `operation: 'foreign-operation'` y comprobar `REQUEST_ID_CONFLICT`; producción solo escribe `operation: 'start'`, sin añadir otro endpoint. Dos requestIds humanos distintos producen dos jobs. Fallo antes de commit no deja recibo; fallo del callback `wake` se reporta sin cambiar una admisión confirmada en error de petición.

- [x] **2. RED:** `node --test tests/start-service.test.mjs`.
- [x] **3. Implementar admisión atómica.** Consultar recibo antes de resolver; dentro del commit volver a comprobar celda ledger. Si existe, comparar ID/actor/hash y devolver respuesta previa; si `record:null`, crear job, índice/cola y recibo juntos. Colisión de job ID nunca sobreescribe otro: abortar con error estable. Un commit fallido no publica celda null.
- [x] **4. Implementar servicios.** Validar que tarea/cwd resueltos corresponden a intención normalizada. `status` no carga resultados; `result` conserva vista «todavía no disponible» sin tratar consulta como fallo del job. No exponer listado/wait/revisión. Llamar a `wake` solo después de admisión durable. `seal` comprueba cierre al entrar y después de resolver configuración; admisiones ya dentro del commit se terminan antes de cerrar el Session y nunca se pierden.
- [x] **5. GREEN:** `node --test tests/start-service.test.mjs tests/repository.test.mjs && npm run check && npm test`.
- [x] **6. Commit:** `feat: add idempotent admission and shared job services`.

## Task 6 — Propiedad, inspección segura y backup SQLite

**Files:** crear `src/infrastructure/storage/lease.ts`, `inspect.ts`, `backup.ts`, `src/infrastructure/durable/legacy-v1.ts`, `tests/storage-maintenance.test.mjs`.

**Interfaces:** `acquireLease(dbPath: string): Promise<Lease>`; `inspectStorage(lease: Lease, context: Context): Promise<StorageInspection>`; `createBackup(lease: Lease, now: Clock): Promise<BackupReceipt>`; `verifyBackup(receipt: BackupReceipt): Promise<void>`. Inspección abre/cierra `Storage`/`createSession` propios, nunca Harness; base vacía se detecta aquí pero se inicializa en tarea 9. `legacy-v1.ts` define `JobsStateV1` y `LegacyJobsDoc` desde el baseline, sin importar tests ni tipos nuevos; se reutiliza en tarea 7.

- [x] **1. Probar lock y rutas.** Canonicalizar padre real para aliases y rechazar base/lock como symlink. Crear lock exclusivo, token, PID y fecha; no borrar por antigüedad. Una segunda adquisición devuelve `STORAGE_BUSY`; doble release no elimina el lock de otro propietario.

```js
const lease = await acquireLease(database);
await assert.rejects(acquireLease(aliasDatabase), hasCode('STORAGE_BUSY'));
await lease.release(); await lease.release();
assert.deepEqual(await inspectFixture('empty'), { kind: 'empty' });
await assert.rejects(inspectFixture('future'), hasCode('STORAGE_VERSION_UNSUPPORTED'));
```

`hasCode(code)` y `inspectFixture(name)` son helpers locales del test. Añadir documento ajeno no vacío y SQLite corrupto: no inicializar ni reanudar. `Storage` usa scans/findDocument/document públicos para versión; no depender del nombre interno de tablas.

- [x] **2. RED:** `node --test tests/storage-maintenance.test.mjs`.
- [x] **3. Implementar lock/inspección.** Mantener misma ruta de sesión que baseline; no cambiar IDs sanitizados. Rechazar mezcla de monolito activo y esquema 2, versiones desconocidas e invariantes inválidas. Liberar handles en `finally`, pero no el lease propiedad del caller. Resolver cambios de identidad de archivo durante inspección como inconsistencia. `sourceHash` es SHA-256 del JSON canónico de `{ version: 1, state: JobsStateV1 }`, sin incluir la ruta; la aprobación comprueba además la ruta canónica.
- [x] **4. Añadir prueba RED de backup con WAL, permisos y fallo.** Mantener una conexión sintética con WAL pendiente; `createBackup` debe incluir la última fila sintética y permitir restauración. Inyectar en tests rechazo del backup y destino no escribible: fuente igual, sin backup aceptado. Verificar hash de archivo cerrado, `0700`/`0600` y no sobrescritura de un backup anterior.
- [x] **5. Implementar backup.** `DatabaseSync` y `backup` públicos; destino `<dbPath>.backups/<timestamp>-<uuid>/backup.sqlite`, con directorio único privado por intento; no seguir symlinks en padre ni destino. `PRAGMA integrity_check` es validación SQLite pública, no modificación de esquema Durable. Verificar lectura v1 sobre copia de verificación cuando abrir backend pueda escribir. Cerrar conexiones antes de devolver recibo; restos incompletos no cuentan como backup.
- [x] **6. GREEN:** `node --test tests/storage-maintenance.test.mjs && npm run check && npm test`.
- [x] **7. Commit:** `feat: guard storage ownership and create verified backups`.

## Task 7 — Conversión v1 autorizada y atómica

**Files:** crear `src/infrastructure/storage/migrate.ts`, `src/application/maintenance.ts`, `tests/migration.test.mjs`; consumir `src/infrastructure/durable/legacy-v1.ts` de tarea 6.

**Interfaces:** `migrateV1(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 2; migratedJobs: number }>`; `createMaintenanceService(context: Context)` produce `migrate({ dbPath, confirm, clock }): Promise<Outcome<{ schemaVersion: 2; migratedJobs: number }>>`, donde `confirm(info: { dbPath: string; jobs: number; sourceHash: string; backupDirectory: string }): Promise<MigrationApproval|undefined>`. Solo adaptador humano llama ese servicio.

- [ ] **1. Escribir pruebas de la ruta completa.** Usar todas las fixtures de tarea 1; leer y reconstruir un `JobsStateV1` desde los nuevos documentos para comparar sin campos nuevos.

```js
assert.deepEqual(await reconstructedLegacy(database), fixture.expected);
assert.equal(await activeLegacyDocument(database), undefined);
assert.equal((await inspectStorage(lease, context)).schemaVersion, 2);
assert.equal((await maintenance.migrate(declinedOptions)).error.code, 'MIGRATION_DECLINED');
```

`reconstructedLegacy` y `activeLegacyDocument` son helpers del test mediante APIs públicas; no leen SQL interno. Probar rechazo de `actor.kind !== human`, path/sourceHash alterados, backup hash inválido y confirmación cancelada sin modificación de jobs. Repetir sobre esquema 2 devuelve cero migrados.

- [ ] **2. RED:** `node --test tests/migration.test.mjs`.
- [ ] **3. Implementar orquestación.** Mantener lease durante revalidación, confirmación, backup y conversión; comprobar aprobación contra ruta/origen actuales. Backend v1 congelado en `legacy-v1.ts`, separado de fixtures y sin importar tipo nuevo para interpretar legado. Recibo administrativo contiene requestId, actor, tiempo, versiones y backup/hash.
- [ ] **4. Implementar conversión en un commit.** Construir/validar equivalencia de destinos antes de publicar; `tx.doc` para todos los destinos y `tx.retireDoc(LegacyJobsDoc)` junto con meta esquema 2. No recrear conversaciones/submissions ni añadir autor a jobs heredados. Validar de nuevo antes de activar runtime; inconsistencia posterior bloquea, no hace rollback automático.
- [ ] **5. Añadir y ejecutar fallos de commit y restauración.** Interponer `Storage.commit` en fixture para rechazo antes de escribir y comprobar v1 intacto; restaurar copia en ruta nueva sin sidecars, abrir con lector v1 y comparar. Falta de recursos deja origen o destino completo, nunca metadatos de migración «exitosa» parcial.
- [ ] **6. GREEN:** `node --test tests/migration.test.mjs tests/storage-maintenance.test.mjs && npm run check && npm test`.
- [ ] **7. Commit:** `feat: migrate v1 jobs with human approval and backup`.

## Task 8 — Ejecución Durable y coordinador recuperable

**Files:** crear `src/infrastructure/durable/execution.ts`, `src/runtime/coordinator.ts`, `tests/coordinator.test.mjs`.

**Interfaces:** `createExecution(harness: Harness, context: Context, tools: ReadonlyMap<string,ToolRegistration>, clock: Clock): DurableExecution`; este expone `create(tx: Tx,job: JobRecord): Promise<number>`, `submit(job: JobRecord): Promise<number>` y `wait(job: JobRecord): Promise<JobResult>`. `createCoordinator({ repository, execution, maxConcurrency, clock, onSettled, report }): Coordinator`, con `recover(): Promise<void>`, `wake(): void`, `drain(): Promise<void>` y `stop(): void`. `onSettled(job: JobRecord,result: JobResult): Promise<void>`; `report(error: unknown): void` no debe lanzar.

- [ ] **1. Escribir pruebas de slots y reentrada.** `execution.create` real crea/configura conversación dentro del commit de `claimNext`; dobles `wake` no sobrepasan slots. Fake controlable para barreras y faux para integración real.

```js
coordinator.wake(); coordinator.wake();
await activeBarrier;
assert.equal((await repository.active()).length, 1);
assert.equal(await repository.queuedPosition(secondId), 1);
assert.equal(await countConversationsFor(firstId), 1);
```

Las barreras/contadores se implementan en helpers del test. Probar recovery `provisioning` después de submit y antes de `markRunning`: mismo `requestId` devuelve mismo submissionId. Probar fallo de creación/configuración: no hay conversación parcial ni pérdida de job.

- [ ] **2. RED:** `node --test tests/coordinator.test.mjs`.
- [ ] **3. Implementar driver.** `configure`, conversación ownerless, IDs y `Conversation.submit({ type:'input', content:job.task, requestId:'pi-agents:'+job.id })` públicos. `wait` extrae `AssistantEntry` y resultado como baseline; no se puentean herramientas de la sesión principal ni cambia replay de CodingTools.
- [ ] **4. Implementar coordinador.** Cola de decisiones serializada; slots se comprueban atómicamente en repositorio. Monitores únicos por ID; ignorar finalización durante cierre hasta reapertura. `stop` impide nuevas admisiones del coordinador; runtime cierra Harness y después `drain` espera monitores. Un error de notificación se reporta, no llama a `finish` con failed.
- [ ] **5. GREEN:** `node --test tests/coordinator.test.mjs && npm run check && npm test`.
- [ ] **6. Commit:** `refactor: isolate durable execution and queue coordination`.

## Task 9 — Runtime por sesión y ownership de recursos

**Files:** crear `src/runtime/session.ts`, `tests/session-runtime.test.mjs`.

**Interfaces:** `openSessionRuntime(options: RuntimeOptions): Promise<SessionRuntime>`; `RuntimeOptions = { storagePath:string; models:Models; context:Context; defaultCwd:string; maxConcurrency:number; now?:Clock; createId?:CreateId; onSettled?:(job:JobRecord,result:JobResult)=>Promise<void>; onReport?:(error:unknown)=>void }`; `SessionRuntime = { jobs: JobsService; close(): Promise<void> }`. La apertura arroja `DomainError` si requiere mantenimiento; no activa scheduler.

- [ ] **1. Escribir pruebas de apertura, fallo y cierre.** Fixtures antiguas deben producir `MIGRATION_REQUIRED`, no llamadas al proveedor. Base vacía crea meta/índice juntos. Error en Harness o inspección libera handles/lease propios. La creación de ModelRuntime se prueba en el adaptador de tarea 10, no en este runtime que recibe `Models`.

```js
await assert.rejects(openSessionRuntime(legacyOptions), hasCode('MIGRATION_REQUIRED'));
assert.equal(modelCalls, 0);
const runtime = await openSessionRuntime(emptyOptions);
await runtime.close(); await runtime.close();
assert.equal((await acquireLease(emptyOptions.storagePath)).dbPath, canonicalPath);
```

Cerrar también el lease adquirido en la aserción mediante `finally`. Añadir fallo de `onSettled` y confirmar que job queda completed; cierre concurrente con `start` no deja un recibo sin job ni un job admitido que se pierda.

- [ ] **2. RED:** `node --test tests/session-runtime.test.mjs`.
- [ ] **3. Implementar lifecycle.** Acquire→inspect→initialize/validate→Harness.open sin progreso→componer repositorio/servicios/coordinador→recover. Ningún `submit`, `wait`, `resume` antes de validar. Definir un propietario por recurso y cleanup inverso; no tener dos Sessions simultáneas escribiendo la misma base.
- [ ] **4. Implementar shutdown.** Sellar admisión en aplicación, detener coordinador, cerrar Harness, drenar monitores y liberar lease; los fallos no dejan una cola de lifecycle permanentemente rechazada. No abortar trabajos por cierre ni duplicar resultado/notificación al reabrir.
- [ ] **5. GREEN:** `node --test tests/session-runtime.test.mjs tests/coordinator.test.mjs && npm run check && npm test`.
- [ ] **6. Commit:** `refactor: compose guarded session runtimes`.

## Task 10 — Adaptadores Pi, mantenimiento TUI y sustitución del monolito

**Files:** crear `src/adapters/pi/resolve.ts`, `display.ts`, `register.ts`, `tests/pi-adapters.test.mjs`, `tests/helpers/pi-host.mjs`; modificar `index.ts`, `tests/jobs.test.mjs`, `tests/recovery.test.mjs`; eliminar `src/jobs.ts` después de portar todas las aserciones.

**Interfaces:** `resolveInput(ctx: ExtensionContext, models: ModelRuntime, intent: StartIntent, bindings: PiBindings): Promise<ResolvedJobInput>`; `formatStatus(view: JobView): string`, `formatResult(view: ResultView): string`, `briefSummary(result: JobResult|undefined,status: JobStatus,maxLength?:number): string`; `registerPiAgents(pi: ExtensionAPI, bindings: PiBindings): void`. `PiBindings` expone `getAgentDir: () => string`, `createModels: typeof ModelRuntime.create`, `resolveModel: typeof resolveCliModel`, `text: (content: string) => Component`, `Type: typeof import('@earendil-works/pi-ai').Type` y `version: string`. Los nombres de tipos públicos se importan con `import type`; únicamente `index.ts` conecta las implementaciones del host. Esto permite probar adaptadores con bindings falsos sin instalar una copia física de Pi ni inventar un loader runtime. El módulo de registro conserva un controlador de sesión/lifecycle, pero no transiciones ni tokens Durable.

- [ ] **1. Escribir tests con host simulado.** Registrar comandos/tool/renderers, simular session_start/shutdown y entradas Pi. Comprobar nombres/esquema exactos de la tool, confianza de proyecto, resolución de modelo y retorno inmediato con ID.

```js
assert.deepEqual(tool.parameters.required, ['agent', 'task']);
assert.deepEqual(await callTool('call-1', args), await callTool('call-1', args));
assert.equal(startRequests[0].actor.kind, 'model');
assert.equal(startRequests[0].requestId, 'tool:call-1');
assert.equal(modelContextEntries.length, 0);
```

Helpers `callTool`/capturas pertenecen a `tests/helpers/pi-host.mjs`; este expone `makePiHost({mode, trusted}): { pi, context, commands, tool, dispatch, entries }`. Invocar factory no abre archivos ni crea timers. Los recibos pueden necesitar normalización de representación, no del ID histórico.

- [ ] **2. RED:** `node --test tests/pi-adapters.test.mjs`.
- [ ] **3. Implementar resolución y presentación.** Mover y tipar comportamiento existente: providers públicos, snapshots, instrucciones, herramientas exactas; no retener contexto de tool para ejecutarla después. `status` conserva modelo efectivo, duración y error sin leer respuesta completa; notificación obtiene el resultado explícitamente cuando necesita resumen.
- [ ] **4. Implementar mantenimiento con test de autoridad.** Solo `ctx.mode === 'tui' && ctx.hasUI` puede confirmar mediante `ctx.ui.confirm`; `hasUI` solo es insuficiente porque RPC lo tiene. Denegar rpc/json/print y llamada desde tool. Usar el path de sesión derivado, nunca argumentos de ruta. Capturar generación/sessionId antes del await; si cambia, no autorizar, no migrar otra base ni usar contexto invalidado.
- [ ] **5. Probar y conectar lifecycle.** Una sesión bloqueada por migración sigue registrando comandos; después de confirmación y conversión reabrir una vez. Manejar error de notificación sin alterar job terminal; comprobar entrada de rama antes de marcar. Mantener controles de confianza tras cambio de sesión. Lifecycle usa recuperación de rechazos y cleanup de apertura parcial. Inyectar un fallo de `bindings.createModels`, reintentar y demostrar que el fallo previo no bloquea para siempre la sesión.
- [ ] **6. Sustituir entrypoint y retirar `JobManager`.** `index.ts` solo compone/registra; portar pruebas existentes a `openSessionRuntime` y servicios conservando todas las aserciones, incluido `queued` en recibo y resultado tras reapertura. Mantener congelado `tests/fixtures/v1/jobs-v1.ts`. Actualizar imports de pruebas; no crear compatibilidad superficial de `src/jobs.ts`.
- [ ] **7. GREEN:** `npm run check && npm test`. Ejecutar smoke sin sesión: `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`; salida 0 y sin error de carga ni acceso al almacenamiento. Guardar versiones/resoluciones; este smoke no prueba una generación real.
- [ ] **8. Commit:** `refactor: connect Pi adapters to phase 00 services`.

## Task 11 — Caídas reales, aceptación y documentación de operación

**Files:** crear `tests/crash-recovery.test.mjs`, `tests/helpers/crash-worker.mjs`, `docs/PHASE-00-ACCEPTANCE.md`; modificar `tests/recovery.test.mjs`, `README.md`, `docs/ARCHITECTURE.md`, `specs/ROADMAP.md`, `specs/00-preparacion-arquitectonica.md` según evidencia.

**Interfaces:** `spawnCrashWorker({ database, scenario }): Promise<{ waitForBarrier(name):Promise<void>; kill():Promise<void>; close():Promise<void> }>` en helper de prueba. Barreras: `queued-committed`, `conversation-committed`, `submission-admitted`, `terminal-committed`, `backup-verified`, `migration-committed`. IPC solo en harness de tests; no crear flags de fallo públicos de producción.

- [ ] **1. Escribir pruebas RED de subprocess.** Matar proceso con SIGKILL en cada barrera, comprobar lock residual y completar liberación manual únicamente tras confirmar su muerte en el test. Reabrir y comparar IDs/resultados; no omitir el paso operativo del lock.

```js
await worker.waitForBarrier('submission-admitted');
await worker.kill();
await assert.rejects(acquireLease(database), hasCode('STORAGE_BUSY'));
await removeVerifiedDeadTestLock(database);
const recovered = await reopenAndWait(database);
assert.equal(recovered.job.conversationId, before.conversationId);
assert.equal(await countSubmissions(database, before.jobId), 1);
```

Los helpers de este bloque se definen en `crash-worker.mjs`/test usando APIs públicas. En migración, afirmar v1 completo o esquema 2 completo; nunca repetir trabajos para «reparar». Barreras antes/durante commit se complementan con inyección de Storage de tarea 7, no sleeps probabilísticos como única evidencia.

- [ ] **2. Ejecutar RED:** `node --test tests/crash-recovery.test.mjs`; registrar la garantía que aún no está demostrada. No introducir un fallo productivo artificial si un escenario ya pasa: dejar constancia de la prueba de caracterización y mantenerla.
- [ ] **3. Implementar helpers y corregir solo brechas demostradas.** No ampliar fases; fallos en protocolo/datos vuelven a la unidad responsable y requieren su prueba de regresión. Probar resultado de 1 MiB con instrumentación real y duplicados de admisión tras caída.
- [ ] **4. GREEN global:** `npm run check && npm test`; repetir smoke de tarea 10. Ningún test pendiente/skipped que cubra un AC puede contarse como aceptado.
- [ ] **5. Verificación TUI humana, sobre estado temporal.** Con autorización para una ejecución de prueba, iniciar Pi con directorio de estado temporal y agente sintético; probar inicio, status, result, notificación sin inyección, confirmación/declinación de migración, reapertura y shutdown. Preferir faux en arnés anfitrión; si se usa proveedor real, pedir permiso por coste y no usar tareas con efectos reales. Registrar comando/entorno y observaciones; si no se puede hacer, mantener fase en validación.
- [ ] **6. Documentar operación real.** README: entorno soportado, comandos actuales y mantenimiento, backup sensible, copia/restauración con Pi cerrado y sin sidecars antiguos, lock residual manual, sin downgrade ni rollback de efectos externos. ARCHITECTURE: unidades nuevas y ventanas de caída reales. Acceptance: tabla AC-00–17 con comandos, resultados, fixtures y limitaciones; nada de «verde» sin evidencia.
- [ ] **7. Revisar rama completa.** Revisor independiente si hay herramienta o sesión disponible; en su ausencia solicitar revisión humana y declarar la limitación, no atribuirse revisión independiente. Verificar que el paquete no incluye backups/config local y que `npm pack --dry-run --json` solo informa el contenido esperado, sin publicar.
- [ ] **8. Commit final:** `test: verify phase 00 recovery and document operations`. Actualizar roadmap a completada únicamente si pasan todos los gates técnicos y la aceptación humana requerida; si falta TUI/revisión o hay fallos, conservar en validación. Integrar la rama solo mediante decisión posterior del usuario.

## Cobertura de spec y criterios

| Criterio | Tareas | Evidencia exigida |
| --- | --- | --- |
| AC-00 | Preparación de ejecución, 1 | Baseline e aislamiento sin rehacer historia. |
| AC-01 | 2 | Fixture de tipo inválido rechazada y check completo verde. |
| AC-02 | 1, 10, 11 | Nueve comportamientos originales conservados. |
| AC-03 | 3–5, 8–10 | Imports/límites, transiciones probadas y adaptadores sin commits. |
| AC-04 | 4, 10, 11 | Storage instrumentado y respuesta de 1 MiB. |
| AC-05 | 4–5, 7–8 | Fallos de commit, índice/job/resultado/ledger coherentes. |
| AC-06–07 | 3, 5, 11 | Hashes, concurrencia, replay, cambios de config y reapertura. |
| AC-08 | 1, 7 | Comparación campo a campo de todas las fixtures. |
| AC-09 | 7, 9–10 | Sin llamadas al modelo ni conversión al denegar/headless. |
| AC-10 | 6–7 | WAL incluido, backup verificable y restauración aislada. |
| AC-11 | 4, 6–7 | Versiones futuras, corrupción, aliases y locks. |
| AC-12–13 | 8–9, 11 | Barreras/subprocess, IDs estables y lock residual explícito. |
| AC-14 | 9–11 | Notificación pendiente/repetida/fallida sin alterar resultado. |
| AC-15 | 3, 5, 7, 10 | Origen de actor y legado sin autor inventado. |
| AC-16 | 2, 10–11 | Inventario de módulos, smoke y prueba TUI diferenciados. |
| AC-17 | 11 | Documentación y roadmap respaldados por evidencia. |

## Autorrevisión y handoff

El plan cubre la conversión estructural en fase 00; revisión/consumo siguen en fase 01. Las tareas posteriores reutilizan los contratos definidos aquí; cualquier cambio de firma debe actualizar consumidores, pruebas y este plan antes de delegar otra tarea.

Decisiones de tooling verificadas durante planificación: npm publica TypeScript `5.9.3` y `@types/node 26.6.4`; Pi `1.0.4` expone `ctx.mode`, y `hasUI` también puede ser true en RPC. Estas inspecciones no acreditan el type-check nuevo ni la migración.

**Recomendación de ejecución:** nativa por el acoplamiento de documentos, repositorio, migración y runtime; conservar gates por tarea. No se encontró una herramienta de subagentes disponible al planificar. La alternativa subagent-driven requiere habilitarla primero; no se simularán implementadores/revisores independientes en el mismo contexto.

Revisar el documento y elegir método antes de ejecutar cualquier tarea. La aprobación de la spec no aprueba este plan automáticamente.
