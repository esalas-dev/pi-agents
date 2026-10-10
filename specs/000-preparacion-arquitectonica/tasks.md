# Tasks: Preparación arquitectónica

**Input**: [spec.md](spec.md) y [plan.md](plan.md).

**Prerequisites**: Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

**Estado del registro**: 71 pasos importados; 71 marcados en el original.
**Uso histórico; NO EJECUTAR como backlog nuevo.** El roadmap da por completada la fase. Las casillas
se importan sin reinterpretar: una casilla vacía no acredita trabajo pendiente ni autoriza repetirlo.
Antes de reusar este plan se requiere reconciliarlo con la evidencia y una solicitud humana nueva.

**Tests**: Se preservan pruebas, comandos, expected failures y gates; no son resultados obtenidos
ahora. Nuevos cambios requieren los controles de la constitución.

**Organization**: Cada paso tiene ID Tnnn. Los US apuntan a escenarios de spec.md. Los nombres T1,
T2… del detalle técnico original identifican bloques, no los nuevos IDs de pasos T001, T002…

## Phase 1: Preparación y autoridad

No se añaden pasos previos nuevos. Aplican la aprobación, dependencias y gates del plan.

## Phase 2: User Story 1 - Migrar y recuperar la base durable sin perder trabajos (Priority: P1)

### Bloque 1: Congelar v1 y caracterizar el contrato existente

**Files:** crear `tests/fixtures/v1/jobs-v1.ts`, `tests/fixtures/v1/README.md`, `tests/helpers/legacy.mjs`, `tests/legacy-fixtures.test.mjs`; modificar `tests/jobs.test.mjs` y `tests/recovery.test.mjs` solo para reutilizar helpers sin debilitar aserciones.

**Interfaces:** consume `JobManager`/`JobsDoc` del baseline. Produce `createLegacyFixture({ directory, scenario }): Promise<{ database: string; expected: object }>` en `tests/helpers/legacy.mjs`; escenarios `queued`, `provisioning`, `running`, `terminal-mix`, `large-result`. Produce `legacyInput(task): ResolvedJobInput` por forma estructural, sin importar tipos nuevos.

- [x] T001 [US1] Escribir caracterización y prueba de fixture. Congelar el contenido exacto de `src/jobs.ts` del commit `efc690f` en `jobs-v1.ts`, con procedencia/hash en README; la prueba no depende del migrador nuevo. Crear bases con APIs públicas y faux; para estados activos usar conversaciones/submissions reales y scheduler detenido o barreras. — alcance: `tests/fixtures/v1/jobs-v1.ts, tests/fixtures/v1/README.md, tests/helpers/legacy.mjs, tests/legacy-fixtures.test.mjs, tests/jobs.test.mjs, tests/recovery.test.mjs, tests/helpers/legacy.mjs`

```js
const f = await createLegacyFixture({ directory, scenario: 'terminal-mix' });
assert.deepEqual(await readLegacy(f.database), f.expected);
assert.equal(f.expected.jobs.psa_done.notified, false);
assert.equal(f.expected.jobs.psa_interrupted.result.status, 'interrupted');
```

`readLegacy(database): Promise<JobsStateV1>` pertenece al helper; cierra todos los handles. `psa_interrupted` es un caso sintético válido, no una ruta de ejecución inventada. `large-result` usa `'x'.repeat(1024 * 1024)`.

- [x] T002 [US1] Ejecutar RED: `node --test tests/legacy-fixtures.test.mjs`; debe fallar por helper/fixture ausente, no por credenciales o red. — alcance: `tests/fixtures/v1/jobs-v1.ts, tests/fixtures/v1/README.md, tests/helpers/legacy.mjs, tests/legacy-fixtures.test.mjs, tests/jobs.test.mjs, tests/recovery.test.mjs, tests/helpers/legacy.mjs`

- [x] T003 [US1] Implementar helper y fixtures reproducibles. Cubrir orden de cola, flags de notificación, IDs de conversación/submission, timestamps y cadena de resultado. No guardar bases de usuario ni regenerar definiciones v1 desde esquema 2. — alcance: `tests/fixtures/v1/jobs-v1.ts, tests/fixtures/v1/README.md, tests/helpers/legacy.mjs, tests/legacy-fixtures.test.mjs, tests/jobs.test.mjs, tests/recovery.test.mjs, tests/helpers/legacy.mjs`

- [x] T004 [US1] Ejecutar GREEN: `node --test tests/legacy-fixtures.test.mjs tests/jobs.test.mjs tests/recovery.test.mjs`; luego `npm test`. Pasan casos nuevos y las nueve pruebas originales. — alcance: `tests/fixtures/v1/jobs-v1.ts, tests/fixtures/v1/README.md, tests/helpers/legacy.mjs, tests/legacy-fixtures.test.mjs, tests/jobs.test.mjs, tests/recovery.test.mjs, tests/helpers/legacy.mjs`

- [x] T005 [US1] Registrar commit autorizado: archivos listados, mensaje `test: freeze v1 storage fixtures and baseline behavior`. — alcance: `tests/fixtures/v1/jobs-v1.ts, tests/fixtures/v1/README.md, tests/helpers/legacy.mjs, tests/legacy-fixtures.test.mjs, tests/jobs.test.mjs, tests/recovery.test.mjs, tests/helpers/legacy.mjs`

### Bloque 2: Type-check real y grafo de módulos comprobable

**Files:** crear `tsconfig.json`, `scripts/host-types.mjs`, `scripts/check-syntax.mjs`, `tests/typecheck.test.mjs`, `tests/host-resolution.test.mjs`; modificar `.gitignore`, `package.json`, `package-lock.json`, `README.md` y anotaciones productivas que `tsc` demuestre incorrectas.

**Interfaces:** `resolveHost({ packageRoot? }): Promise<{ root: string; version: string; declarations: Record<string,string> }>` y `generateHostConfig({ root, outFile }): Promise<void>` en `host-types.mjs`. Override `PI_AGENTS_PI_PACKAGE_ROOT`; si falta, localizar binario `pi` en PATH y resolver su raíz real, sin ruta Homebrew hardcodeada. Resolver exports públicos bajo condiciones `types`/`import`, incluidos subpaths; no asumir `require.resolve` CJS para un paquete ESM.

- [x] T006 [US1] Escribir pruebas de resolución y rechazo de tipos. Ejecutar el compilador en subprocess con un fixture temporal deliberadamente incorrecto: — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

```js
assert.notEqual(await typecheckSource('const count: number = "wrong";'), 0);
assert.equal(await typecheckSource('const count: number = 1;'), 0);
assert.match((await resolveHost({ packageRoot: realHost })).version, /^1\.0\.4$/);
await assert.rejects(resolveHost({ packageRoot: missingHost }), /Pi/);
```

`typecheckSource(source): Promise<number>` es helper de `tests/typecheck.test.mjs`, con cleanup temporal. Probar un subpath público de `pi-ai` y registrar raíz/versiones local y host sin fingir identidad de instancia.

- [x] T007 [US1] RED: `node --test tests/typecheck.test.mjs tests/host-resolution.test.mjs`; falta tooling o falla detección controlada. — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

- [x] T008 [US1] Instalar solo herramientas de desarrollo autorizadas por este plan: `npm install --save-dev --save-exact --omit=peer typescript@5.9.3 @types/node@26.6.4`. Versiones consultadas en npm durante planificación; no se instalaron al escribirlo. Revisar el diff del lockfile y no aceptar actualización colateral de pins. — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

- [x] T009 [US1] Implementar configuración. `strict: true`, `noEmit: true`, `target: "ES2022"`, `module`/`moduleResolution: "NodeNext"`, `allowImportingTsExtensions: true`, `skipLibCheck: true` (excepción aprobada por el usuario durante ejecución: validar código propio y uso de tipos, no los cuerpos de `.d.ts` externos); incluir `index.ts` y `src//*.ts`. Generar `.cache/pi-agents/tsconfig.host.json` con paths absolutos locales, nunca versionarlos. Dependencias host siguen como peers `*`. — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

- [x] T010 [US1] Integrar scripts. `check:types` genera config y ejecuta `tsc --noEmit -p .cache/pi-agents/tsconfig.host.json`; `check:syntax` recorre `index.ts` y todos los `.ts` de `src`; `check` encadena ambos. Actualizar `engines.node` a `>=26.10.0` y explicar la matriz limitada. Corregir tipos productivos con API pública; si falla una declaración incompatible del grafo externo, detener el gate, no silenciarla. — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

- [x] T011 [US1] GREEN: `npm run check && npm test`. Registrar `pi-ai` local 1.0.1 y host 1.0.4. No concluir compatibilidad runtime hasta tareas 10–11. — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

- [x] T012 [US1] Registrar commit autorizado: `build: add strict host-aware TypeScript checks`. — alcance: `tsconfig.json, scripts/host-types.mjs, scripts/check-syntax.mjs, tests/typecheck.test.mjs, tests/host-resolution.test.mjs, package.json`

### Bloque 3: Contratos de dominio, errores y canonización

**Files:** crear `src/domain/jobs.ts`, `src/domain/errors.ts`, `src/domain/requests.ts`, `tests/domain.test.mjs`.

**Interfaces:** produce tipos de la sección común; `publicStatus(job: Pick<JobRecord,"status">): JobStatusPublic`; `transition(job: JobRecord, next: JobStatus, at: number): JobRecord` (nuevo objeto, transición inválida falla); `canonicalStart(request: StartRequest): { normalized: StartRequest; payloadHash: string; key: string }`; `DomainError extends Error` con `error: AppError`; `failure(error: unknown): Outcome<never>`.

- [x] T013 [US1] Escribir tabla de transiciones y canonización. Permitir queued→provisioning, provisioning→running y fallo desde cualquier no terminal; running→completed; terminales inmutables. No introducir producción de `interrupted` nueva. Validar números finitos, estados y herramientas sin depender de Durable. — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, tests/domain.test.mjs`

```js
assert.equal(publicStatus({ status: 'provisioning' }), 'running');
assert.equal(canonicalStart(a).payloadHash, canonicalStart(reorderedA).payloadHash);
assert.notEqual(canonicalStart(a).payloadHash, canonicalStart(changedActor).payloadHash);
assert.throws(() => canonicalStart({ ...a, requestId: '' }), DomainError);
assert.equal(Object.hasOwn(JSON.parse('{"__proto__":1}'), '__proto__'), true);
```

Los últimos datos alimentan además casos de diccionario de tarea 4; no rechazar un ID solo por coincidir con propiedad del prototipo. Fijar tarea con trim exterior, espacios interiores conservados, agente sensible a mayúsculas, cwd absoluto normalizado y actor id ausente omitido, nunca `undefined` serializado.

- [x] T014 [US1] RED: `node --test tests/domain.test.mjs`. — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, tests/domain.test.mjs`

- [x] T015 [US1] Implementar contratos puros. Thinking: `off|minimal|low|medium|high|xhigh|max`. Códigos de error exactamente los de la spec; detalles de error público JSON seguros. Hash SHA-256 de JSON canónico UTF-8 con claves ordenadas; la clave de ledger es SHA-256 de requestId completo. Ningún import de Pi/TUI/SQLite en dominio. — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, tests/domain.test.mjs`

- [x] T016 [US1] GREEN: `node --test tests/domain.test.mjs && npm run check && npm test`. — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, tests/domain.test.mjs`

- [x] T017 [US1] Registrar commit autorizado: `refactor: define job domain and request contracts`. — alcance: `src/domain/jobs.ts, src/domain/errors.ts, src/domain/requests.ts, tests/domain.test.mjs`

### Bloque 4: Documentos separados y repositorio transaccional

**Files:** crear `src/infrastructure/durable/documents.ts`, `src/infrastructure/durable/repository.ts`, `tests/helpers/store.mjs`, `tests/repository.test.mjs`.

**Interfaces:** tokens/kinds/versiones de la spec; `createJobRepository(session: Session, context: Context, clock: Clock, createId: CreateId): JobRepository`. `JobRepository` expone `get(id: string): Promise<JobRecord|undefined>`, `result(id: string): Promise<JobResult|undefined>`, `queuedPosition(id: string): Promise<number|undefined>`, `active(): Promise<JobRecord[]>`, `unnotified(): Promise<JobRecord[]>`, `markNotified(id: string): Promise<void>`, `finish(id: string,result: JobResult,at: number): Promise<void>`, `markRunning(id: string,submissionId: number,at: number): Promise<void>` y `claimNext(maxConcurrency: number, createConversation: CreateConversation): Promise<JobRecord|undefined>`. El callback infra `CreateConversation` es `(tx: Tx, job: JobRecord) => Promise<number>`; no se expone a dominio/adaptadores Pi.

`tests/helpers/store.mjs` produce `makeStoreFixture(): Promise<{ session, repository, close, reopen, readKinds, seedJob }>`; `seedJob(job,result?)` es exclusivamente helper de prueba.

- [x] T018 [US1] Escribir pruebas atómicas y de lectura diferida. Instrumentar el `Storage` público para registrar `document`/`findDocument` y mapear IDs a kinds, sin tocar internals. Vaciar registro antes de cada consulta. — alcance: `src/infrastructure/durable/documents.ts, src/infrastructure/durable/repository.ts, tests/helpers/store.mjs, tests/repository.test.mjs, tests/helpers/store.mjs`

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

- [x] T019 [US1] RED: `node --test tests/repository.test.mjs`. — alcance: `src/infrastructure/durable/documents.ts, src/infrastructure/durable/repository.ts, tests/helpers/store.mjs, tests/repository.test.mjs, tests/helpers/store.mjs`

- [x] T020 [US1] Implementar documentos. Esquema global 2, tokens individuales v1. Familias job/result con seed real al crear y seed `null` al exigir existencia; `initial(null)` lanza `STORAGE_INCONSISTENT`, nunca fabrica un job. `get`/`result` usan `snapshot`, no `tx.doc`. Ledger tendrá celda `{ record: RequestRecord|null }`; `null` solo puede existir durante una admisión aún no confirmada (tarea 5). — alcance: `src/infrastructure/durable/documents.ts, src/infrastructure/durable/repository.ts, tests/helpers/store.mjs, tests/repository.test.mjs, tests/helpers/store.mjs`

- [x] T021 [US1] Implementar operaciones del repositorio. Índice compacto sin tareas, prompts, respuestas ni errores grandes; metadatos de resultado en job. `claimNext` comprueba slots dentro del commit y ejecuta el callback de creación/configuración en ese mismo commit; si falla, no consumir cola ni publicar conversación. `finish` es condicional e inmutable después de terminal; `markNotified` repetido no altera timestamps otra vez. — alcance: `src/infrastructure/durable/documents.ts, src/infrastructure/durable/repository.ts, tests/helpers/store.mjs, tests/repository.test.mjs, tests/helpers/store.mjs`

- [x] T022 [US1] GREEN: `node --test tests/repository.test.mjs && npm run check && npm test`. Comprobar queue/job/result/index juntos mediante reapertura. — alcance: `src/infrastructure/durable/documents.ts, src/infrastructure/durable/repository.ts, tests/helpers/store.mjs, tests/repository.test.mjs, tests/helpers/store.mjs`

- [x] T023 [US1] Registrar commit autorizado: `feat: add partitioned durable job repository`. — alcance: `src/infrastructure/durable/documents.ts, src/infrastructure/durable/repository.ts, tests/helpers/store.mjs, tests/repository.test.mjs, tests/helpers/store.mjs`

### Bloque 5: Admisión idempotente y servicios de consulta actuales

**Files:** crear `src/application/start.ts`, `src/application/jobs.ts`, `tests/start-service.test.mjs`; ampliar `repository.ts` y `tests/helpers/store.mjs`.

**Interfaces:** repositorio añade `receipt(requestId: string): Promise<RequestRecord|undefined>` y `admit(request: StartRequest, input: ResolvedJobInput): Promise<AdmissionReceipt>`. `createStartService(repository: JobRepository, wake: () => void, report: (error: unknown) => void): StartService` produce `start(request: StartRequest, resolve: ResolveInput): Promise<Outcome<AdmissionReceipt>>` y `seal(): void`; tras sellar, nuevas llamadas devuelven `RUNTIME_CLOSING`. `createJobsService(repository,startService): JobsService` expone `start` anterior, `status(id): Promise<Outcome<JobView>>`, `result(id): Promise<Outcome<ResultView>>`, `markNotified(id): Promise<Outcome<void>>` y `unnotified(): Promise<Outcome<JobRecord[]>>`.

- [x] T024 [US1] Escribir pruebas de replay, conflicto y consulta. Preparar `resolve` faux que cuenta invocaciones y devuelve `legacyInput`; no iniciar scheduler. — alcance: `src/application/start.ts, src/application/jobs.ts, tests/start-service.test.mjs, tests/helpers/store.mjs`

```js
const one = await service.start(request, resolve);
const again = await service.start(request, () => { throw Error('config changed'); });
assert.deepEqual(again, one);
assert.equal(resolveCalls, 1);
assert.equal((await service.start(changedPayloadSameId, resolve)).error.code, 'REQUEST_ID_CONFLICT');
assert.equal((await jobs.status('missing')).error.code, 'JOB_NOT_FOUND');
```

Añadir `Promise.all` de dos admisiones iguales, reapertura y replay; cambiar actor debe confligir. Para operación distinta, sembrar un recibo con `operation: 'foreign-operation'` y comprobar `REQUEST_ID_CONFLICT`; producción solo escribe `operation: 'start'`, sin añadir otro endpoint. Dos requestIds humanos distintos producen dos jobs. Fallo antes de commit no deja recibo; fallo del callback `wake` se reporta sin cambiar una admisión confirmada en error de petición.

- [x] T025 [US1] RED: `node --test tests/start-service.test.mjs`. — alcance: `src/application/start.ts, src/application/jobs.ts, tests/start-service.test.mjs, tests/helpers/store.mjs`

- [x] T026 [US1] Implementar admisión atómica. Consultar recibo antes de resolver; dentro del commit volver a comprobar celda ledger. Si existe, comparar ID/actor/hash y devolver respuesta previa; si `record:null`, crear job, índice/cola y recibo juntos. Colisión de job ID nunca sobreescribe otro: abortar con error estable. Un commit fallido no publica celda null. — alcance: `src/application/start.ts, src/application/jobs.ts, tests/start-service.test.mjs, tests/helpers/store.mjs`

- [x] T027 [US1] Implementar servicios. Validar que tarea/cwd resueltos corresponden a intención normalizada. `status` no carga resultados; `result` conserva vista «todavía no disponible» sin tratar consulta como fallo del job. No exponer listado/wait/revisión. Llamar a `wake` solo después de admisión durable. `seal` comprueba cierre al entrar y después de resolver configuración; admisiones ya dentro del commit se terminan antes de cerrar el Session y nunca se pierden. — alcance: `src/application/start.ts, src/application/jobs.ts, tests/start-service.test.mjs, tests/helpers/store.mjs`

- [x] T028 [US1] GREEN: `node --test tests/start-service.test.mjs tests/repository.test.mjs && npm run check && npm test`. — alcance: `src/application/start.ts, src/application/jobs.ts, tests/start-service.test.mjs, tests/helpers/store.mjs`

- [x] T029 [US1] Registrar commit autorizado: `feat: add idempotent admission and shared job services`. — alcance: `src/application/start.ts, src/application/jobs.ts, tests/start-service.test.mjs, tests/helpers/store.mjs`

### Bloque 6: Propiedad, inspección segura y backup SQLite

**Files:** crear `src/infrastructure/storage/lease.ts`, `inspect.ts`, `backup.ts`, `src/infrastructure/durable/legacy-v1.ts`, `tests/storage-maintenance.test.mjs`.

**Interfaces:** `acquireLease(dbPath: string): Promise<Lease>`; `inspectStorage(lease: Lease, context: Context): Promise<StorageInspection>`; `createBackup(lease: Lease, now: Clock): Promise<BackupReceipt>`; `verifyBackup(receipt: BackupReceipt): Promise<void>`. Inspección abre/cierra `Storage`/`createSession` propios, nunca Harness; base vacía se detecta aquí pero se inicializa en tarea 9. `legacy-v1.ts` define `JobsStateV1` y `LegacyJobsDoc` desde el baseline, sin importar tests ni tipos nuevos; se reutiliza en tarea 7.

- [x] T030 [US1] Probar lock y rutas. Canonicalizar padre real para aliases y rechazar base/lock como symlink. Crear lock exclusivo, token, PID y fecha; no borrar por antigüedad. Una segunda adquisición devuelve `STORAGE_BUSY`; doble release no elimina el lock de otro propietario. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

```js
const lease = await acquireLease(database);
await assert.rejects(acquireLease(aliasDatabase), hasCode('STORAGE_BUSY'));
await lease.release(); await lease.release();
assert.deepEqual(await inspectFixture('empty'), { kind: 'empty' });
await assert.rejects(inspectFixture('future'), hasCode('STORAGE_VERSION_UNSUPPORTED'));
```

`hasCode(code)` y `inspectFixture(name)` son helpers locales del test. Añadir documento ajeno no vacío y SQLite corrupto: no inicializar ni reanudar. `Storage` usa scans/findDocument/document públicos para versión; no depender del nombre interno de tablas.

- [x] T031 [US1] RED: `node --test tests/storage-maintenance.test.mjs`. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

- [x] T032 [US1] Implementar lock/inspección. Mantener misma ruta de sesión que baseline; no cambiar IDs sanitizados. Rechazar mezcla de monolito activo y esquema 2, versiones desconocidas e invariantes inválidas. Liberar handles en `finally`, pero no el lease propiedad del caller. Resolver cambios de identidad de archivo durante inspección como inconsistencia. `sourceHash` es SHA-256 del JSON canónico de `{ version: 1, state: JobsStateV1 }`, sin incluir la ruta; la aprobación comprueba además la ruta canónica. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

- [x] T033 [US1] Añadir prueba RED de backup con WAL, permisos y fallo. Mantener una conexión sintética con WAL pendiente; `createBackup` debe incluir la última fila sintética y permitir restauración. Inyectar en tests rechazo del backup y destino no escribible: fuente igual, sin backup aceptado. Verificar hash de archivo cerrado, `0700`/`0600` y no sobrescritura de un backup anterior. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

- [x] T034 [US1] Implementar backup. `DatabaseSync` y `backup` públicos; destino `<dbPath>.backups/<timestamp>-<uuid>/backup.sqlite`, con directorio único privado por intento; no seguir symlinks en padre ni destino. `PRAGMA integrity_check` es validación SQLite pública, no modificación de esquema Durable. Verificar lectura v1 sobre copia de verificación cuando abrir backend pueda escribir. Cerrar conexiones antes de devolver recibo; restos incompletos no cuentan como backup. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

- [x] T035 [US1] GREEN: `node --test tests/storage-maintenance.test.mjs && npm run check && npm test`. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

- [x] T036 [US1] Registrar commit autorizado: `feat: guard storage ownership and create verified backups`. — alcance: `src/infrastructure/storage/lease.ts, src/infrastructure/durable/legacy-v1.ts, tests/storage-maintenance.test.mjs`

### Bloque 7: Conversión v1 autorizada y atómica

**Files:** crear `src/infrastructure/storage/migrate.ts`, `src/application/maintenance.ts`, `tests/migration.test.mjs`; consumir `src/infrastructure/durable/legacy-v1.ts` de tarea 6.

**Interfaces:** `migrateV1(lease: Lease, approval: MigrationApproval, backup: BackupReceipt, context: Context): Promise<{ schemaVersion: 2; migratedJobs: number }>`; `createMaintenanceService(context: Context)` produce `migrate({ dbPath, confirm, clock }): Promise<Outcome<{ schemaVersion: 2; migratedJobs: number }>>`, donde `confirm(info: { dbPath: string; jobs: number; sourceHash: string; backupDirectory: string }): Promise<MigrationApproval|undefined>`. Solo adaptador humano llama ese servicio.

- [x] T037 [US1] Escribir pruebas de la ruta completa. Usar todas las fixtures de tarea 1; leer y reconstruir un `JobsStateV1` desde los nuevos documentos para comparar sin campos nuevos. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

```js
assert.deepEqual(await reconstructedLegacy(database), fixture.expected);
assert.equal(await activeLegacyDocument(database), undefined);
assert.equal((await inspectStorage(lease, context)).schemaVersion, 2);
assert.equal((await maintenance.migrate(declinedOptions)).error.code, 'MIGRATION_DECLINED');
```

`reconstructedLegacy` y `activeLegacyDocument` son helpers del test mediante APIs públicas; no leen SQL interno. Probar rechazo de `actor.kind !== human`, path/sourceHash alterados, backup hash inválido y confirmación cancelada sin modificación de jobs. Repetir sobre esquema 2 devuelve cero migrados.

- [x] T038 [US1] RED: `node --test tests/migration.test.mjs`. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

- [x] T039 [US1] Implementar orquestación. Mantener lease durante revalidación, confirmación, backup y conversión; comprobar aprobación contra ruta/origen actuales. Backend v1 congelado en `legacy-v1.ts`, separado de fixtures y sin importar tipo nuevo para interpretar legado. Recibo administrativo contiene requestId, actor, tiempo, versiones y backup/hash. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

- [x] T040 [US1] Implementar conversión en un commit. Construir/validar equivalencia de destinos antes de publicar; `tx.doc` para todos los destinos y `tx.retireDoc(LegacyJobsDoc)` junto con meta esquema 2. No recrear conversaciones/submissions ni añadir autor a jobs heredados. Validar de nuevo antes de activar runtime; inconsistencia posterior bloquea, no hace rollback automático. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

- [x] T041 [US1] Añadir y ejecutar fallos de commit y restauración. Interponer `Storage.commit` en fixture para rechazo antes de escribir y comprobar v1 intacto; restaurar copia en ruta nueva sin sidecars, abrir con lector v1 y comparar. Falta de recursos deja origen o destino completo, nunca metadatos de migración «exitosa» parcial. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

- [x] T042 [US1] GREEN: `node --test tests/migration.test.mjs tests/storage-maintenance.test.mjs && npm run check && npm test`. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

- [x] T043 [US1] Registrar commit autorizado: `feat: migrate v1 jobs with human approval and backup`. — alcance: `src/infrastructure/storage/migrate.ts, src/application/maintenance.ts, tests/migration.test.mjs, src/infrastructure/durable/legacy-v1.ts`

### Bloque 8: Ejecución Durable y coordinador recuperable

**Files:** crear `src/infrastructure/durable/execution.ts`, `src/runtime/coordinator.ts`, `tests/coordinator.test.mjs`.

**Interfaces:** `createExecution(harness: Harness, context: Context, tools: ReadonlyMap<string,ToolRegistration>, clock: Clock): DurableExecution`; este expone `create(tx: Tx,job: JobRecord): Promise<number>`, `submit(job: JobRecord): Promise<number>` y `wait(job: JobRecord): Promise<JobResult>`. `createCoordinator({ repository, execution, maxConcurrency, clock, onSettled, report }): Coordinator`, con `recover(): Promise<void>`, `wake(): void`, `drain(): Promise<void>` y `stop(): void`. `onSettled(job: JobRecord,result: JobResult): Promise<void>`; `report(error: unknown): void` no debe lanzar.

- [x] T044 [US1] Escribir pruebas de slots y reentrada. `execution.create` real crea/configura conversación dentro del commit de `claimNext`; dobles `wake` no sobrepasan slots. Fake controlable para barreras y faux para integración real. — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, tests/coordinator.test.mjs`

```js
coordinator.wake(); coordinator.wake();
await activeBarrier;
assert.equal((await repository.active()).length, 1);
assert.equal(await repository.queuedPosition(secondId), 1);
assert.equal(await countConversationsFor(firstId), 1);
```

Las barreras/contadores se implementan en helpers del test. Probar recovery `provisioning` después de submit y antes de `markRunning`: mismo `requestId` devuelve mismo submissionId. Probar fallo de creación/configuración: no hay conversación parcial ni pérdida de job.

- [x] T045 [US1] RED: `node --test tests/coordinator.test.mjs`. — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, tests/coordinator.test.mjs`

- [x] T046 [US1] Implementar driver. `configure`, conversación ownerless, IDs y `Conversation.submit({ type:'input', content:job.task, requestId:'pi-agents:'+job.id })` públicos. `wait` extrae `AssistantEntry` y resultado como baseline; no se puentean herramientas de la sesión principal ni cambia replay de CodingTools. — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, tests/coordinator.test.mjs`

- [x] T047 [US1] Implementar coordinador. Cola de decisiones serializada; slots se comprueban atómicamente en repositorio. Monitores únicos por ID; ignorar finalización durante cierre hasta reapertura. `stop` impide nuevas admisiones del coordinador; runtime cierra Harness y después `drain` espera monitores. Un error de notificación se reporta, no llama a `finish` con failed. — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, tests/coordinator.test.mjs`

- [x] T048 [US1] GREEN: `node --test tests/coordinator.test.mjs && npm run check && npm test`. — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, tests/coordinator.test.mjs`

- [x] T049 [US1] Registrar commit autorizado: `refactor: isolate durable execution and queue coordination`. — alcance: `src/infrastructure/durable/execution.ts, src/runtime/coordinator.ts, tests/coordinator.test.mjs`

### Bloque 9: Runtime por sesión y ownership de recursos

**Files:** crear `src/runtime/session.ts`, `tests/session-runtime.test.mjs`.

**Interfaces:** `openSessionRuntime(options: RuntimeOptions): Promise<SessionRuntime>`; `RuntimeOptions = { storagePath:string; models:Models; context:Context; defaultCwd:string; maxConcurrency:number; now?:Clock; createId?:CreateId; onSettled?:(job:JobRecord,result:JobResult)=>Promise<void>; onReport?:(error:unknown)=>void }`; `SessionRuntime = { jobs: JobsService; close(): Promise<void> }`. La apertura arroja `DomainError` si requiere mantenimiento; no activa scheduler.

- [x] T050 [US1] Escribir pruebas de apertura, fallo y cierre. Fixtures antiguas deben producir `MIGRATION_REQUIRED`, no llamadas al proveedor. Base vacía crea meta/índice juntos. Error en Harness o inspección libera handles/lease propios. La creación de ModelRuntime se prueba en el adaptador de tarea 10, no en este runtime que recibe `Models`. — alcance: `src/runtime/session.ts, tests/session-runtime.test.mjs`

```js
await assert.rejects(openSessionRuntime(legacyOptions), hasCode('MIGRATION_REQUIRED'));
assert.equal(modelCalls, 0);
const runtime = await openSessionRuntime(emptyOptions);
await runtime.close(); await runtime.close();
assert.equal((await acquireLease(emptyOptions.storagePath)).dbPath, canonicalPath);
```

Cerrar también el lease adquirido en la aserción mediante `finally`. Añadir fallo de `onSettled` y confirmar que job queda completed; cierre concurrente con `start` no deja un recibo sin job ni un job admitido que se pierda.

- [x] T051 [US1] RED: `node --test tests/session-runtime.test.mjs`. — alcance: `src/runtime/session.ts, tests/session-runtime.test.mjs`

- [x] T052 [US1] Implementar lifecycle. Acquire→inspect→initialize/validate→Harness.open sin progreso→componer repositorio/servicios/coordinador→recover. Ningún `submit`, `wait`, `resume` antes de validar. Definir un propietario por recurso y cleanup inverso; no tener dos Sessions simultáneas escribiendo la misma base. — alcance: `src/runtime/session.ts, tests/session-runtime.test.mjs`

- [x] T053 [US1] Implementar shutdown. Sellar admisión en aplicación, detener coordinador, cerrar Harness, drenar monitores y liberar lease; los fallos no dejan una cola de lifecycle permanentemente rechazada. No abortar trabajos por cierre ni duplicar resultado/notificación al reabrir. — alcance: `src/runtime/session.ts, tests/session-runtime.test.mjs`

- [x] T054 [US1] GREEN: `node --test tests/session-runtime.test.mjs tests/coordinator.test.mjs && npm run check && npm test`. — alcance: `src/runtime/session.ts, tests/session-runtime.test.mjs`

- [x] T055 [US1] Registrar commit autorizado: `refactor: compose guarded session runtimes`. — alcance: `src/runtime/session.ts, tests/session-runtime.test.mjs`

### Bloque 10: Adaptadores Pi, mantenimiento TUI y sustitución del monolito

**Files:** crear `src/adapters/pi/resolve.ts`, `display.ts`, `register.ts`, `tests/pi-adapters.test.mjs`, `tests/helpers/pi-host.mjs`; modificar `index.ts`, `tests/jobs.test.mjs`, `tests/recovery.test.mjs`; eliminar `src/jobs.ts` después de portar todas las aserciones.

**Interfaces:** `resolveInput(ctx: ExtensionContext, models: ModelRuntime, intent: StartIntent, bindings: PiBindings): Promise<ResolvedJobInput>`; `formatStatus(view: JobView): string`, `formatResult(view: ResultView): string`, `briefSummary(result: JobResult|undefined,status: JobStatus,maxLength?:number): string`; `registerPiAgents(pi: ExtensionAPI, bindings: PiBindings): void`. `PiBindings` expone `getAgentDir: () => string`, `createModels: typeof ModelRuntime.create`, `resolveModel: typeof resolveCliModel`, `text: (content: string) => Component`, `Type: typeof import('@earendil-works/pi-ai').Type` y `version: string`. Los nombres de tipos públicos se importan con `import type`; únicamente `index.ts` conecta las implementaciones del host. Esto permite probar adaptadores con bindings falsos sin instalar una copia física de Pi ni inventar un loader runtime. El módulo de registro conserva un controlador de sesión/lifecycle, pero no transiciones ni tokens Durable.

- [x] T056 [US1] Escribir tests con host simulado. Registrar comandos/tool/renderers, simular session_start/shutdown y entradas Pi. Comprobar nombres/esquema exactos de la tool, confianza de proyecto, resolución de modelo y retorno inmediato con ID. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

```js
assert.deepEqual(tool.parameters.required, ['agent', 'task']);
assert.deepEqual(await callTool('call-1', args), await callTool('call-1', args));
assert.equal(startRequests[0].actor.kind, 'model');
assert.equal(startRequests[0].requestId, 'tool:call-1');
assert.equal(modelContextEntries.length, 0);
```

Helpers `callTool`/capturas pertenecen a `tests/helpers/pi-host.mjs`; este expone `makePiHost({mode, trusted}): { pi, context, commands, tool, dispatch, entries }`. Invocar factory no abre archivos ni crea timers. Los recibos pueden necesitar normalización de representación, no del ID histórico.

- [x] T057 [US1] RED: `node --test tests/pi-adapters.test.mjs`. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

- [x] T058 [US1] Implementar resolución y presentación. Mover y tipar comportamiento existente: providers públicos, snapshots, instrucciones, herramientas exactas; no retener contexto de tool para ejecutarla después. `status` conserva modelo efectivo, duración y error sin leer respuesta completa; notificación obtiene el resultado explícitamente cuando necesita resumen. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

- [x] T059 [US1] Implementar mantenimiento con test de autoridad. Solo `ctx.mode === 'tui' && ctx.hasUI` puede confirmar mediante `ctx.ui.confirm`; `hasUI` solo es insuficiente porque RPC lo tiene. Denegar rpc/json/print y llamada desde tool. Usar el path de sesión derivado, nunca argumentos de ruta. Capturar generación/sessionId antes del await; si cambia, no autorizar, no migrar otra base ni usar contexto invalidado. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

- [x] T060 [US1] Probar y conectar lifecycle. Una sesión bloqueada por migración sigue registrando comandos; después de confirmación y conversión reabrir una vez. Manejar error de notificación sin alterar job terminal; comprobar entrada de rama antes de marcar. Mantener controles de confianza tras cambio de sesión. Lifecycle usa recuperación de rechazos y cleanup de apertura parcial. Inyectar un fallo de `bindings.createModels`, reintentar y demostrar que el fallo previo no bloquea para siempre la sesión. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

- [x] T061 [US1] Sustituir entrypoint y retirar `JobManager`. `index.ts` solo compone/registra; portar pruebas existentes a `openSessionRuntime` y servicios conservando todas las aserciones, incluido `queued` en recibo y resultado tras reapertura. Mantener congelado `tests/fixtures/v1/jobs-v1.ts`. Actualizar imports de pruebas; no crear compatibilidad superficial de `src/jobs.ts`. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

- [x] T062 [US1] GREEN: `npm run check && npm test`. Ejecutar smoke sin sesión: `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`; salida 0 y sin error de carga ni acceso al almacenamiento. Guardar versiones/resoluciones; este smoke no prueba una generación real. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

- [x] T063 [US1] Registrar commit autorizado: `refactor: connect Pi adapters to phase 00 services`. — alcance: `src/adapters/pi/resolve.ts, tests/pi-adapters.test.mjs, tests/helpers/pi-host.mjs, index.ts, tests/jobs.test.mjs, tests/recovery.test.mjs, src/jobs.ts, index.ts`

### Bloque 11: Caídas reales, aceptación y documentación de operación

**Files:** crear `tests/crash-recovery.test.mjs`, `tests/helpers/crash-worker.mjs`, `docs/PHASE-00-ACCEPTANCE.md`; modificar `tests/recovery.test.mjs`, `README.md`, `docs/ARCHITECTURE.md`, `specs/ROADMAP.md`, `specs/000-preparacion-arquitectonica/spec.md` según evidencia.

**Interfaces:** `spawnCrashWorker({ database, scenario }): Promise<{ waitForBarrier(name):Promise<void>; kill():Promise<void>; close():Promise<void> }>` en helper de prueba. Barreras: `queued-committed`, `conversation-committed`, `submission-admitted`, `terminal-committed`, `backup-verified`, `migration-committed`. IPC solo en harness de tests; no crear flags de fallo públicos de producción.

- [x] T064 [US1] Escribir pruebas RED de subprocess. Matar proceso con SIGKILL en cada barrera, comprobar lock residual y completar liberación manual únicamente tras confirmar su muerte en el test. Reabrir y comparar IDs/resultados; no omitir el paso operativo del lock. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

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

- [x] T065 [US1] Ejecutar RED: `node --test tests/crash-recovery.test.mjs`; registrar la garantía que aún no está demostrada. No introducir un fallo productivo artificial si un escenario ya pasa: dejar constancia de la prueba de caracterización y mantenerla. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

- [x] T066 [US1] Implementar helpers y corregir solo brechas demostradas. No ampliar fases; fallos en protocolo/datos vuelven a la unidad responsable y requieren su prueba de regresión. Probar resultado de 1 MiB con instrumentación real y duplicados de admisión tras caída. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

- [x] T067 [US1] GREEN global: `npm run check && npm test`; repetir smoke de tarea 10. Ningún test pendiente/skipped que cubra un AC puede contarse como aceptado. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

- [x] T068 [US1] Verificación TUI humana, sobre estado temporal. Con autorización para una ejecución de prueba, iniciar Pi con directorio de estado temporal y agente sintético; probar inicio, status, result, notificación sin inyección, confirmación/declinación de migración, reapertura y shutdown. Preferir faux en arnés anfitrión; si se usa proveedor real, pedir permiso por coste y no usar tareas con efectos reales. Registrar comando/entorno y observaciones; si no se puede hacer, mantener fase en validación. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

- [x] T069 [US1] Documentar operación real. README: entorno soportado, comandos actuales y mantenimiento, backup sensible, copia/restauración con Pi cerrado y sin sidecars antiguos, lock residual manual, sin downgrade ni rollback de efectos externos. ARCHITECTURE: unidades nuevas y ventanas de caída reales. Acceptance: tabla AC-00–17 con comandos, resultados, fixtures y limitaciones; nada de «verde» sin evidencia. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

- [x] T070 [US1] Revisar rama completa. Revisor independiente si hay herramienta o sesión disponible; en su ausencia solicitar revisión humana y declarar la limitación, no atribuirse revisión independiente. Verificar que el paquete no incluye backups/config local y que `npm pack --dry-run --json` solo informa el contenido esperado, sin publicar. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

- [x] T071 [US1] Registrar commit final autorizado: `test: verify phase 00 recovery and document operations`. Actualizar roadmap a completada únicamente si pasan todos los gates técnicos y la aceptación humana requerida; si falta TUI/revisión o hay fallos, conservar en validación. Integrar la rama solo mediante decisión posterior del usuario. — alcance: `tests/crash-recovery.test.mjs, tests/helpers/crash-worker.mjs, docs/PHASE-00-ACCEPTANCE.md, tests/recovery.test.mjs, docs/ARCHITECTURE.md, specs/ROADMAP.md, specs/000-preparacion-arquitectonica/spec.md`

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
| Bloque 2 | US1 | T006–T012 |
| Bloque 3 | US1 | T013–T017 |
| Bloque 4 | US1 | T018–T023 |
| Bloque 5 | US1 | T024–T029 |
| Bloque 6 | US1 | T030–T036 |
| Bloque 7 | US1 | T037–T043 |
| Bloque 8 | US1 | T044–T049 |
| Bloque 9 | US1 | T050–T055 |
| Bloque 10 | US1 | T056–T063 |
| Bloque 11 | US1 | T064–T071 |

## Implementation Strategy

Ejecutar solo después de confirmar autoridad y el estado actual del trabajo. Verificar el escenario
independiente de cada historia, registrar versiones/comandos/resultados y detenerse ante fallos.
No cerrar fases por marcar casillas ni sustituir revisión independiente o aceptación humana por mocks.

## Notes

Original completo: [archivo histórico](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-06-fase-00-preparacion-arquitectonica.md).
Las discrepancias de estado se registran en [MIGRATION.md](../MIGRATION.md), no se resuelven
inventando comprobaciones, cambiando casillas o implementando funciones.
