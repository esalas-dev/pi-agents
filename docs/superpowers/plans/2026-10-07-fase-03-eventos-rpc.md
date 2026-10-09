# Fase 03 — Eventos durables y RPC v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer RPC v1 a extensiones locales de confianza y emitir eventos persistidos atómicamente con las transiciones de jobs.

**Architecture:** Adaptador fino sobre `pi.events` y `JobsService`, ledger existente y outbox transaccional por sesión. Un propietario de lifecycle controla generaciones, endpoints, esperas y un emisor ordenado; SQLite mantiene la autoridad. Las tareas son secuenciales porque almacenamiento, control y transporte comparten estas interfaces.

**Tech Stack:** TypeScript estricto, Node `26.10.0`, host Pi detectado (actualmente `1.1.0`), Pi Durable `1.0.1`, SQLite y `node:test`; sin dependencias nuevas.

**Spec:** [`../specs/2026-10-07-fase-03-eventos-rpc-design.md`](../specs/2026-10-07-fase-03-eventos-rpc-design.md), aprobada humanamente sobre `e0d0a99`; precisión de límites de IDs aprobada durante esta planificación.

**Estado:** Plan aprobado humanamente; método elegido: subagent-driven con pi-durable-subagents. Perfiles de fase 03 autorizados por separado. Preparación de ejecución en `.worktrees/phase-03`, rama `feat/phase-03`, base `e0d0a99`. La implementación y sus gates aún no han comenzado.

## Global Constraints

- Entorno comprobado: macOS arm64, Node `26.10.0`, host Pi detectado (actualmente `1.1.0`), Pi Durable `1.0.1`; la prueba valida la alineación del host y sus peers sin fijar una versión Pi, sin prometer compatibilidad histórica ni universal posterior.
- Namespace exclusivamente `pi-durable-subagents:*`; no registrar `subagents:*`.
- RPC `protocolVersion: 1`; actor siempre `{ kind: "extension", id: callerId }`; callerId declarativo, no autenticado.
- `review` RPC siempre devuelve `RPC_REVIEW_FORBIDDEN`; no allowlist, aprobación RPC ni migración RPC.
- Cancelación activa requiere consentimiento humano TUI, comprobado frente al estado transaccional; pausa activa mantiene `PAUSE_ACTIVE_UNSUPPORTED`.
- `requestId`, `callerId`, `sessionId`: strings no vacíos, máximo 256 bytes UTF-8; correlación ASCII `[A-Za-z0-9._-]`, de 1 a 128 caracteres. Descartar IDs excesivos sin respuesta ni contenido en logs.
- Consultas cortas: 5 s; mutaciones: 30 s; wait: máximo 300 s; list: máximo 100; sobre result completo: máximo 65536 bytes; ventana reciente: 1000 emitidos.
- Ledger durable existente, sin TTL ni caché RPC autoritativa. Correlación no pertenece al hash de intención.
- Mutación, ledger aplicable y evento en el mismo commit Durable, desde todas las entradas; ningún evento por rechazo, replay o mera notificación Pi.
- Emitir y después confirmar; posibles duplicados estables. Sin ack de consumidor, exactly-once, replay público ni GC física histórica.
- Pendientes nunca se descartan. Migración humana 4→5 con backup verificado y outbox inicialmente vacío, sin eventos históricos.
- No tareas, prompts, paths, snapshots internos, motivos libres, errores internos ni cuerpos de resultados en eventos/consultas/errores.
- No nuevas cuotas ni backpressure del dominio sin aprobación. No instalar tooling, migrar datos reales, publicar, fusionar o promover sin el gate humano correspondiente.

## Review Focus

1. IDs Unicode y metadatos grandes: contar bytes, no caracteres; rechazo sin efecto y result incluyendo escaping dentro de 65536 bytes (T1, T8).
2. queued→running mientras se solicita cancelación: exigir consentimiento dentro de la transacción; diálogo tardío no autoriza (T4, T8).
3. Review approved→rejected entre acceso y replay: acceso conforme a revisión vigente, sin cuerpo antiguo ni segundo consumo (T4, T8).
4. Reapertura del mismo sessionId mientras resuelve una promesa antigua: generación distinta, sin publicaciones ni confirmaciones heredadas (T7, T8).
5. Fallo al confirmar una emisión y backlog de varias páginas: conservar el pendiente, no saltar secuencias; emisor y reciente reconstruibles (T2, T6).

## Preparación para la ejecución (evidencia en el ledger SDD)

- [x] Leer spec y plan completos; registrar aprobación del plan y método elegido.
- [x] Usar `using-git-worktrees` para crear aislamiento de fase 03. Base funcional: `f87d77e`; diseño versionado en `e0d0a99`. Preservar los cambios documentales locales y `.pi/`; no copiar configuración local al paquete ni hacer stash automático.
- [x] Inventariar `git status --short --branch`, `node --version`, `pi --version`; correr `npm run check`, `npm test` y `git diff --check` como baseline. Si falta tooling, preguntar antes de instalar; la receta previamente validada fue `npm ci --omit=peer`.
- [x] Registrar el commit de partida efectivo, versiones y resultados. Parar y diagnosticar si falla el baseline; no declarar fase 03 responsable de fallos previos.

## Mapa de archivos y contratos

Las rutas nuevas son propuestas, no componentes existentes. No dividir globalmente `register.ts` ni introducir otro runtime singleton.

| Unidad | Archivos | Responsabilidad |
| --- | --- | --- |
| API pública | `rpc.ts`, `src/public/rpc-contracts.ts`, `src/public/job-events.ts`, `src/public/rpc-client.ts` | Tipos, validación, DTO, canales y cliente caller sin importar servicios internos |
| Persistencia outbox | `src/infrastructure/durable/outbox-documents.ts`, `outbox.ts` | Documentos, append transaccional, pendientes y confirmación |
| Transiciones | `src/infrastructure/durable/repository.ts` | Instrumentar commits existentes, no callbacks postcommit |
| Autoridad | `src/application/{control,result,jobs,wait}.ts`, `src/domain/errors.ts` | Confirmación interna, revisión vigente, sellado y terminal cancelado |
| Migración | `src/infrastructure/storage/{inspect,migrate,schema4-source}.ts`, `src/application/maintenance.ts` | Snapshot/hash de fuente completa, migración autorizada y rutas antiguas |
| Runtime | `src/runtime/{session,coordinator,generation,outbox-emitter}.ts` | Recursos, generaciones, emisor y cierre sin cancelar jobs |
| Pi | `src/adapters/pi/{lifecycle,rpc,register}.ts` | Compartir runtime con comando/tools y resolver/confirmar desde contexto vigente |
| Evidencia | tests nuevos, `docs/RPC.md`, `docs/PHASE-03-ACCEPTANCE.md` | Contratos, integración caller y gates con evidencia separada |

### Interfaces compartidas a fijar en T1

- `RpcOperation = "ping" | "status" | "list" | "wait" | "result" | "spawn" | "control" | "review"`.
- `RpcParams`: ping `{}`; status `{id}`; list `{statuses?,agent?,createdBefore?,createdAfter?,pendingReview?,limit?,cursor?}`; wait `{id,until?,timeoutSeconds?}`; result `{id,operation:"peek"|"consume"}`; spawn `{agent,task}`; control `{id,action:"pause"|"resume"|"cancel"|"retry",reason?}`. `review` admite solo un objeto JSON sin autoridad ejecutable y siempre se rechaza.
- `RpcRequest<O>`: `{protocolVersion:1,requestId,correlationId,callerId,sessionId,params:RpcParams[O]}`; solo ping permite omitir sessionId. `RpcResponse<O>`: correlación/solicitud/sesión y versión, más unión success/data o failure/error, nunca ambos.
- `RpcJobDto`: `{id,status:JobStatusPublic,agent:string,model:{provider,modelId},createdAt,updatedAt,startedAt?,finishedAt?,queuePosition?,durationMs?,hasResult,reviewStatus,consumption:{count,firstConsumedAt?,lastConsumedAt?}}`. Ningún campo adicional del job interno.
- `RpcDiscovery`: `{protocolVersion:1,sessionId,implementationVersion,operations,capabilities:{query,wait,result,spawn,control,rpcReview:false,activePause:false,activeCancel:{requiresHumanConfirmation:true,available:boolean}},limits:{maxListPage:100,maxWaitSeconds:300,maxResultBytes:65536,recentEventWindow:1000,queryTimeoutMs:5000,mutationTimeoutMs:30000,maxIdBytes:256,maxCorrelationLength:128}}`.
- `RpcData`: ping discovery; status/wait `RpcJobDto`; list `{items:RpcJobDto[],nextCursor?}`; spawn `{jobId,status:"queued",agent}`; control `{jobId,requestId,action,previousStatus,status,replayed,appliedAt,retryJobId?,retryOf?,attemptNumber?}` con estados públicos; result `{job:RpcJobDto,result:{text,totalBytes,sha256,truncated,durationMs,model,status}}`; review no tiene data exitoso.
- `RpcError`: `{code,message,retryable,details:{}}`. Tipo code: `Exclude<ErrorCode,"CONTROL_CONFLICT"|"ACTIVE_CANCEL_CONFIRMATION_REQUIRED">` más los seis códigos públicos de §9 de la spec. Mensajes estáticos sanitizados. `RpcValidationError extends Error` con propiedad `code:RpcError['code']` permite validar el protocolo sin extender los errores internos del dominio con códigos de transporte.
- `JobEventType`: los doce tipos de §6 (`queued`, `provisioning`, `started`, `paused`, `resumed`, `cancel-requested`, `cancelled`, `completed`, `failed`, `interrupted`, `reviewed`, `consumed`, con prefijo `job.`).
- `JobEventV1`: `{protocolVersion:1,eventId,sequence,sessionId,jobId,type,occurredAt,data:{status:JobStatusPublic,agent:string,hasResult,reviewStatus?,consumptionCount?,retryOf?}}`. Instantes y secuencias numéricos finitos; secuencia entera positiva segura.
- `EventBusLike`: `emit(channel:string,data:unknown):void`, `on(channel:string,handler:(data:unknown)=>void):()=>void`. No prometer await del consumidor.
- `TimerApi`: `setTimeout(handler:()=>void,ms:number):ReturnType<typeof setTimeout>`, `clearTimeout(handle):void`; pruebas usan reloj controlado y siempre restauran timers.

## Task 1: Contratos y proyecciones públicas (AC-01,02,07,13)

**Files:** crear `src/public/rpc-contracts.ts`, `src/public/job-events.ts`, `tests/rpc-contracts.test.mjs`.

**Interfaces:** produce `parseRpcRequest<O>(operation:O,input:unknown):RpcRequest<O>`, `parseRpcResponse<O>(operation:O,input:unknown):RpcResponse<O>`, `requestChannel(operation)`, `replyChannel(operation,correlationId)`, `eventChannel(type)` y `projectJob(view:JobQueryView):RpcJobDto`. Producir `isSafeCorrelation(input:unknown):input is string` y `hasOversizedIds(input:unknown):boolean` para el descarte previo sin canal reflejado. Throw de validación sanitizado, no payload. Tipos compartidos del mapa anterior.

- [ ] **1. Escribir tests rojos** para v1, versión desconocida, params desconocidos, actor/confirmation/cwd inyectados, circularidad, bigint, NaN, funciones y prototipos no JSON. Verificar límites UTF-8 y adición opcional a respuestas; los campos requeridos deben conservar tipo, límites y coherencia success/data/error.

```js
assert.equal(Buffer.byteLength('é'.repeat(128)), 256);
assert.equal(parseRpcRequest('status', { ...valid, requestId: 'é'.repeat(128) }).requestId.length, 128);
assert.throws(() => parseRpcRequest('status', { ...valid, requestId: 'é'.repeat(129) }));
assert.throws(() => parseRpcRequest('spawn', { ...valid, params: { agent: 'a', task: 't', actor: 'human' } }));
assert.equal(projectJob(provisioningView).status, 'running');
assert.equal(JSON.stringify(projectJob(sensitiveView)).includes('SECRET_SENTINEL'), false);
```

`valid`, `provisioningView` y `sensitiveView` se definen en este test, con todos los campos requeridos y secretos en task/cwd/agent.systemPrompt/resultMeta.error/lastConsumer/requestIds. No aceptar getters ni objetos custom con efectos durante validación; inspeccionar descriptores antes de leer valores.
- [ ] **2. Ejecutar** `node --test tests/rpc-contracts.test.mjs`; esperado FAIL por módulo/exports nuevos ausentes.
- [ ] **3. Implementar** las firmas indicadas, JSON estricto y allowlists; sin resolver agentes, abrir SQLite ni persistir respuestas. Reutilizar valores de estados/filtros del dominio sin exportar snapshots.
- [ ] **4. Ejecutar** la prueba y `npm run check`; esperado código 0.
- [ ] **5. Commit** `feat: define public RPC v1 and event contracts`, incluyendo solo los tres archivos de esta tarea.

## Task 2: Almacenamiento transaccional del outbox (AC-04,06)

**Files:** crear `src/infrastructure/durable/outbox-documents.ts`, `src/infrastructure/durable/outbox.ts`, `tests/outbox.test.mjs`.

**Interfaces:** `OutboxMetaDoc`, `OutboxEventDocFamily`, `OutboxPageDocFamily`; `OutboxMeta={nextSequence:number,nextToEmit:number,recent:{eventId:string,sequence:number}[]}`; evento `{envelope:JobEventV1,emittedAt?:number}`; página `{sequences:number[]}`. `AppendEventInput={sessionId,jobId,type,occurredAt,data:JobEventV1['data']}`; `appendEvent(tx:Tx,input:AppendEventInput):Promise<JobEventV1>`. `OutboxRepository={pending(limit:number):Promise<JobEventV1[]>;markEmitted(eventId:string,sequence:number,at:number):Promise<void>}`; `createOutboxRepository(session:Session,context:Context):OutboxRepository`.

- [ ] **1. Escribir tests rojos** con SQLite temporal real (`createSession`/`openNodeSqliteStorage`), cierre y reopen: append comparte commit, rollback conserva secuencia 1 y no evento, más de 256 pendientes atraviesan páginas, doble confirmación es no-op, confirmar fuera de orden falla, reciente termina en 1000 sin eliminar documentos/pendientes.

```js
assert.equal((await outbox.pending(1))[0].sequence, 1);
await assert.rejects(() => outbox.markEmitted(second.eventId, 2, 2000));
await outbox.markEmitted(first.eventId, 1, 2000);
await outbox.markEmitted(first.eventId, 1, 2001);
assert.equal((await session.snapshot(OutboxMetaDoc, context)).nextToEmit, 2);
```

- [ ] **2. Ejecutar** `node --test tests/outbox.test.mjs`; esperado FAIL por módulo ausente.
- [ ] **3. Implementar** páginas de **256 secuencias** con key `String(Math.floor((sequence-1)/256))`, y event family key `String(sequence)`. ID estable SHA-256 de JSON `[sessionId,sequence]`, prefijo `evt_`; verificar identidad al confirmar. Append inicia nextSequence/nextToEmit en 1 y escribe meta/evento/página en el Tx recibido, sin commit anidado. Confirmación retira solo la referencia pendiente, avanza cursor, agrega reciente y conserva últimas 1000 referencias. No usar scan de todos los eventos para cada drenaje; overflow de entero seguro produce `STORAGE_ERROR` antes de cambiar nada.
- [ ] **4. Ejecutar** prueba y `npm run check`; esperado código 0, sin pérdida tras reopen.
- [ ] **5. Commit** `feat: persist paginated transactional event outbox` con los tres archivos nuevos.

## Task 3: Eventos en cada commit observable (AC-03,04,13)

**Files:** modificar `src/infrastructure/durable/repository.ts`, `src/runtime/session.ts`, `src/adapters/pi/register.ts`, `tests/helpers/store.mjs`, `tests/coordinator.test.mjs`, `tests/{jobs,recovery,session-runtime,session-query-runtime,session-control-runtime}.test.mjs`; crear `tests/job-events.test.mjs`, `tests/helpers/outbox-crash-worker.mjs`, `tests/outbox-crash.test.mjs`.

**Interfaces:** extender `createJobRepository(session,context,clock,createId,sessionId:string):JobRepository` y `RuntimeOptions.sessionId:string` requerido. Actualizar el callsite de runtime, el runtimeOptions de register con sessionManager.getSessionId() y todas las factories de tests en esta misma tarea, con ID estable en reopen, para mantener type-check y suite verdes. No cambios restantes a firmas del repositorio en esta tarea. Fixture store pasa sessionId estable `test-session`, crea outbox vacío y permite observar fallos de storage mediante opción `failCommit?: (writes:unknown[])=>boolean`; reopen conserva el mismo sessionId y fixture.session debe ser getter del recurso actual, igual que fixture.repository. Writer de T2 dentro del Tx existente.

- [ ] **1. Escribir tests rojos** de admit/claimNext/markRunning/finish, applyControl/retry/finishCancelled, decideReview/consume. Por cada fila de §6, verificar tipo, payload y exactamente un append por cambio efectivo; doble finish, markNotified, rechazo y replay no agregan eventos. `create` escribe queued solo al crear realmente un job queued; no permitir sobrescribir silenciosamente un job existente o importar estados arbitrarios como nuevos eventos. Los casos históricos de provisioning de `tests/coordinator.test.mjs` se preparan con `fixture.seedJob`, no con el método productivo `create`. Migración y seed de fixtures siguen siendo rutas explícitas separadas, sin eventos retroactivos.

```js
await Promise.all([repository.admit(req, input), repository.admit(req, input)]);
assert.equal((await outbox.pending(10)).length, 1);
assert.equal((await outbox.pending(10))[0].type, 'job.queued');
assert.equal(JSON.stringify(await outbox.pending(10)).includes('SECRET_SENTINEL'), false);
```

`req` es intención canónica y `input` válido, creados en el test. Failpoint en el storage público rechaza el commit que contiene documento `pi-agents.outbox-event`: confirmar ausencia conjunta de job/ledger/evento y secuencia intacta. El worker de caídas abre DB temporal, admite y notifica al padre por IPC en puntos antes/después del commit; el padre lo termina, reabre y compara estado completo. No añadir hooks de crash al producto.
- [ ] **2. Ejecutar** `node --test tests/job-events.test.mjs tests/outbox-crash.test.mjs`; esperado FAIL por falta de eventos asociados.
- [ ] **3. Instrumentar** los commits efectivos con append de T2, incluyendo coordinador/reconciliación a través de sus métodos de repositorio. Construir payload por allowlist desde el estado efectivo; resumed no crea queued y retry crea queued solo para el nuevo job. `job.reviewed` representa cambio efectivo de la decisión pública, no un nuevo evento por reasignar el mismo estado. Omitir propiedades opcionales undefined de canonical JSON, especialmente reason de review; preservar hashes/receipts existentes, no recalcular ledger histórico. Rechazar operaciones repetidas antes del append.
- [ ] **4. Ejecutar** pruebas nuevas, `npm test`, `npm run check`; esperado código 0. Registrar los puntos de caída efectivamente probados.
- [ ] **5. Commit** `feat: commit lifecycle events with durable job mutations` con los archivos de esta tarea.

## Task 4: Autoridad transaccional y replay de resultados (AC-08,09,10)

**Files:** modificar `src/domain/{errors,requests}.ts`, `src/application/{control,result,jobs,wait}.ts`, `src/infrastructure/durable/repository.ts`, `src/adapters/pi/register.ts`, `tests/{control,review-consume,wait,pi-control-adapters}.test.mjs`; crear `tests/control-confirmation.test.mjs`.

**Interfaces:** exportar `ControlAdmission={requireActiveConfirmation:boolean,activeCancellationConfirmed:boolean}` desde `src/domain/requests.ts` para uso interno, no parte de ControlRequest ni de su hash. `ControlService.control(id,request,admission?:ControlAdmission):Promise<Outcome<ControlReceipt>>`, misma extensión en `JobsService.control` y `JobRepository.applyControl(id,request,at,admission?)`. Ausencia mantiene comportamiento interno previo; RPC siempre pasa requireActiveConfirmation=true. Error interno `ACTIVE_CANCEL_CONFIRMATION_REQUIRED`, nunca expuesto literalmente por RPC. `JobRepository.readAuthorizedResult(id:string,access:ResultAccess):Promise<ResultView>` usa lectura coherente en un commit Durable y nunca emite evento de lectura.

- [ ] **1. Escribir tests rojos**: cancelar queued sin consentimiento; insertar claim/markRunning entre lectura de policy y applyControl, esperar error interno, job running y ledger/eventos sin intención cancel. Reintentar tras consentimiento produce una intención; replay de ella no necesita nuevo consentimiento pero sí policy vigente. Actors model/extension de otro propietario no reciben recibo. Para consume: aprobado→consumido→rechazado→replay no retorna result, no incrementa count ni agrega consumed. Pending tiene igual gate. Peek obtiene revisión y cuerpo de una lectura coherente.

```js
assert.equal((await service.control(id, cancel, { requireActiveConfirmation: true, activeCancellationConfirmed: false })).error.code, 'ACTIVE_CANCEL_CONFIRMATION_REQUIRED');
const replay = await results.consumeResult(id, sameConsume);
assert.equal(replay.error.code, 'RESULT_REJECTED');
assert.equal((await repository.consumption(id)).count, 1);
```

Además, `waitForJob` sobre cancelled con until terminal debe resolver sin esperar 300 s. No cambiar la elegibilidad de result cancelled: conservar `RESULT_NOT_READY` del servicio actual.
- [ ] **2. Ejecutar** `node --test tests/control-confirmation.test.mjs tests/review-consume.test.mjs tests/wait.test.mjs`; esperado FAIL por race/replay/terminal hoy no cubiertos.
- [ ] **3. Implementar** gate activo contra job del Tx, después de reconocer replay válido y antes de nueva intención; mantener política de propietario de `ControlService`. Comando/tool también pasan requireActiveConfirmation=true y evidencia interna solo después de consentimiento TUI (preservar `--yes` humano TUI de fase 02); cubrir su carrera queued→running sin cambio de estado si no se confirmó. Un consumidor interno que omite las opciones no representa un endpoint RPC. Comprobar revisión/resultado vigentes dentro de consume antes de devolver receipt histórico. `ResultService.getResult` usa readAuthorizedResult, no consulta unrestricted `jobs.result`; en consume devuelve resultado autorizado y vuelve a verificar acceso actual. Añadir cancelled al predicado terminal de wait. No convertir actor extension en human ni poner confirmation en ledger/payload.
- [ ] **4. Ejecutar** pruebas anteriores, tests de control/retry existentes, `npm test`, `npm run check`; esperado código 0.
- [ ] **5. Commit** `fix: enforce active control confirmation and current result review` con archivos de esta tarea, sin modificar reglas generales de ownership.

## Task 5: Esquema 5 y migración humana 4→5 (AC-14)

**Files:** modificar `src/infrastructure/durable/documents.ts`, `src/infrastructure/storage/{inspect,migrate}.ts`, `src/application/maintenance.ts`, `src/runtime/session.ts`, `src/adapters/pi/register.ts`, `tests/session-query-runtime.test.mjs`, `tests/session-control-runtime.test.mjs`, `tests/{migration,migration-v2,migration-v3}.test.mjs`; crear `src/infrastructure/storage/schema4-source.ts`, `tests/helpers/v4.mjs`, `tests/migration-v4.test.mjs`.

**Interfaces:** extender uniones storageSchemaVersion con 5. `schema4Source(session:Session,storage:Storage,context:Context):Promise<{sourceHash:string;jobs:number}>`; usar scanDocuments público por páginas de 100 y keys de los documentos actuales, incluyendo **todo** RequestLedgerDocFamily, no solo IDs deducibles de jobs. `migrateV4ToV5(lease:Lease,approval:MigrationApproval,backup:BackupReceipt,context:Context):Promise<{schemaVersion:5;migratedJobs:number}>`.

- [ ] **1. Escribir tests rojos**: fixture v4 con jobs reales, resultados, review/consumption/control y ledger con intenciones antiguas; consentimiento human, backup verificable, hash consistente, cambio atómico de meta/index y outbox vacío. Decline deja v4 intacta. Backup corrupto/sourceHash distinto/actor extension no migran. Reopen conserva recibos; esquema futuro falla.

```js
assert.equal(after.meta.storageSchemaVersion, 5);
assert.deepEqual(after.ledger, before.ledger);
assert.equal(after.outbox.nextSequence, 1);
assert.equal(after.outbox.recent.length, 0);
assert.deepEqual(await outbox.pending(100), []);
```

Fixture v4 se crea con commits directos, no con repo nuevo ni datos inventados a partir de v3 sin verificar sus campos. Snapshot incluye todos los ledger cells. Cortar proceso antes/después del commit de migración reutilizando patrón de T3: solo esquema 4 completo o 5 completo. Pruebas de mantenimiento antiguo verifican cada escalón 1→2→3→4→5, consentimiento y backup por escalón, sin una migración silenciosa.
- [ ] **2. Ejecutar** `node --test tests/migration-v4.test.mjs tests/migration-v3.test.mjs tests/session-query-runtime.test.mjs tests/session-control-runtime.test.mjs`; esperado FAIL por schema 5 ausente.
- [ ] **3. Implementar** hash canónico compartido por inspect/migrate, incluyendo meta/index/jobs/results/reviews/consumptions/control/ledger. Mantener migraciones antiguas; mantenimiento current=5 retorna no-op, current=4 requiere aprobación y backup. Runtime vacío inicializa schema 5+outbox, schema 4 requiere migración y desconocidos fallan. Actualizar fixture current de session-query a 5 y conservar prueba explícita que v4 requiere migrar. En tests de migraciones antiguas, conservar assertions de cada escalón y agregar la llamada humana 4→5 antes del no-op current; no cambiar todos los resultados intermedios a 5. La TUI recorre mantenimiento aprobado hasta current=5; cada negativa detiene apertura, sin ready.
- [ ] **4. Ejecutar** todos los tests de migración/mantenimiento y `npm run check`; esperado código 0 y preservación profunda del ledger.
- [ ] **5. Commit** `feat: migrate schema 4 to durable outbox schema 5` con los archivos de esta tarea.

## Task 6: Emisor ordenado con confirmación posterior (AC-05,06,13)

**Files:** crear `src/runtime/outbox-emitter.ts`, `tests/outbox-emitter.test.mjs`; modificar `src/runtime/session.ts` para exponer outbox y suscripción.

**Interfaces:** `SessionRuntime` añade `outbox:OutboxRepository` y `subscribeOutboxWake(listener:()=>void):()=>void`; la suscripción usa `Session.subscribeCommits` público, agenda wake mediante microtask y no llama Session APIs desde el callback síncrono. `createOutboxEmitter(options:{outbox,bus:EventBusLike,isActive:()=>boolean,clock:Clock,subscribeWake:(listener:()=>void)=>()=>void,report:(error:unknown)=>void}):{start():void;wake():void;stop():Promise<void>}`. Start/stop idempotentes; un solo drain en vuelo.

- [ ] **1. Escribir tests rojos** con outbox real y bus controlado: emitir antes de markEmitted, fallo de confirmación conserva primero y no salta segundo, reopen duplica mismo eventId/sequence, error síncrono de emit conserva pendiente, listener que rechaza asíncronamente no se interpreta como nack. Más de 256 eventos cruza páginas, recent=1000 tras >1000 emitidos y generación inactiva no emite.

```js
assert.equal(deliveries[0].eventId, deliveriesAfterReopen[0].eventId);
assert.equal(deliveries[0].sequence, deliveriesAfterReopen[0].sequence);
assert.deepEqual(observedSequences, [...observedSequences].sort((a, b) => a - b));
assert.equal(unsubscribeCount, 1);
```

- [ ] **2. Ejecutar** `node --test tests/outbox-emitter.test.mjs`; esperado FAIL por emisor ausente.
- [ ] **3. Implementar** lotes de **64** eventos, `setImmediate` entre lotes y comprobación de generación inmediatamente antes de emit. Tras emit, confirmar aunque stop haya empezado si esa confirmación ya está admitida; stop espera esa operación corta, no consumidores. Ante fallo detener lote y programar reintento local de **1000 ms**, cancelable en stop; persistencia permanece autoritativa. report sanitiza y no captura envelope. Un wake posterior no crea un segundo loop concurrente. Nueva generación se crea con un nuevo emisor, no reusa closures.
- [ ] **4. Ejecutar** prueba, tests de outbox/crash y `npm run check`; esperado código 0.
- [ ] **5. Commit** `feat: drain pending events with ordered emit-then-confirm delivery` con los tres archivos indicados.

## Task 7: Lifecycle compartido y cierre por generación (AC-01,11,12)

**Files:** crear `src/runtime/generation.ts`, `src/adapters/pi/lifecycle.ts`, `tests/pi-lifecycle.test.mjs`; modificar `src/runtime/{session,coordinator}.ts`, `src/infrastructure/durable/repository.ts`, `src/application/jobs.ts`, `src/adapters/pi/register.ts`, `tests/{jobs,recovery,session-runtime,session-query-runtime,session-control-runtime}.test.mjs`.

**Interfaces:** `GenerationScope={sessionId:string;signal:AbortSignal;phase:"opening"|"active"|"closing"|"closed";activate():void;seal():void;close():void;isActive():boolean}`, creado por `createGeneration(sessionId:string)` con identidad nueva en cada apertura. Consumir `RuntimeOptions.sessionId:string` requerido desde T3; Pi pasa el ID real de su sessionManager. `JobsService.seal():void` y `JobRepository.seal():void`; `SessionRuntime.seal():void` y close idempotente. Sellar el repositorio bloquea commits nuevos; Session/Harness.close drena los ya admitidos sin depender de promesas del resolver o de confirmaciones UI. `PiSessionState={sessionId,runtime:SessionRuntime,models:ModelRuntime,context:ExtensionContext,generation:GenerationScope}`. `LifecycleBindings=PiBindings & {openRuntime?:typeof openSessionRuntime}` permite inyectar apertura en tests sin hooks de crash. `createPiLifecycle(pi:ExtensionAPI,bindings:LifecycleBindings,hooks:{onOpen(state:PiSessionState):Promise<()=>Promise<void>>}):{ensure(ctx):Promise<PiSessionState>;close():Promise<void>}`; cleanup devuelto por onOpen limpia endpoint/emisor antes de cerrar runtime.

- [ ] **1. Escribir tests rojos** de startup/switch/reload mismo sessionId/shutdown: identidad nueva, seal inmediato al comenzar cambio, listeners y timers retirados una vez, no ready al fallar/declinar apertura, espera abortada sin cancelar job. Fake runtime inyectado mediante bindings de lifecycle para apertura diferida/rechazada; no herramientas productivas de crash. Mantener exactamente las seis tools y el comando registrados.

```js
assert.notEqual(first.generation, reopenedSameSession.generation);
assert.equal(first.generation.isActive(), false);
assert.equal(oldPublications.length, 0);
assert.equal(abortJobCalls, 0);
assert.equal(bus.listenerCount(), 0);
```

Probar close con ejecución todavía activa: termina el cierre de recursos sin exigir completar la generación del modelo ni persistir cancelación; el job continúa recuperable.
- [ ] **2. Ejecutar** `node --test tests/pi-lifecycle.test.mjs tests/session-runtime.test.mjs tests/pi-adapters.test.mjs tests/pi-query-adapters.test.mjs`; esperado FAIL por lifecycle/interfaces nuevos.
- [ ] **3. Implementar** extracción mínima de state/open/ensure/close desde register. Serializar aperturas/cierres y sellar generación antes de await; cada session_start fuerza nueva generación, incluso mismo sessionId, mientras ensure reutiliza únicamente la generación activa vigente. ensure no reabre sesión usando contexto antiguo. JobsService rechaza nuevas mutaciones tras seal, incluyendo consume desde getResult, control/retry/review/markNotified, y sella repositorio. El repositorio comprueba seal antes de admitir cada commit, también si un servicio pasó validación antes del cierre y llegó tarde a persistencia. StartService conserva seal propio. Coordinator deja de admitir claims/continuaciones y comprueba stop después de cada await antes de nuevos efectos; no esperar coordinator.drain en close, pues incluye waits del modelo. Session/Harness.close drena commits de almacenamiento ya admitidos y libera recursos, sin llamar abort a jobs; después se libera lease. No bloquear cierre en resolvers/UI todavía no admitidos a persistencia. Conservar drain del coordinador para tests/ejecución normal y suprimir reports/notificaciones de generaciones invalidadas. El propietario activa la generación tras recuperar runtime y luego invoca onOpen; si el hook falla, invalida y limpia los recursos. En esta tarea el hook se prueba con recursos controlados y register conserva sus comandos/tools sin anunciar RPC todavía. T8 integra el hook productivo que instala endpoint, emite ready y arranca emisor en ese orden. onClose invalida respuestas, aborta esperas y cancela timers primero.
- [ ] **4. Ejecutar** tests indicados, todos los session-runtime/control/recovery y `npm test`, `npm run check`; esperado código 0 y sin handles de prueba vivos.
- [ ] **5. Commit** `refactor: own session RPC and event resources by generation` con archivos de esta tarea; no dividir renderers/formatters ni el parser.

## Task 8: Servidor RPC sobre servicios y consentimiento real (AC-01,02,03,07–13)

**Files:** crear `src/adapters/pi/rpc.ts`, `tests/helpers/rpc.mjs`, `tests/rpc-server.test.mjs`, `tests/rpc-authority.test.mjs`; modificar `src/adapters/pi/{register,lifecycle}.ts`.

**Interfaces:** `registerRpcServer(options:{bus:EventBusLike,state:PiSessionState,resolve:ResolveInput,confirmActiveCancellation:(id:string)=>Promise<boolean>,timers?:TimerApi}):{seal():void;close():Promise<void>;discovery():RpcDiscovery}`. Confirm callback comprueba mode=tui/hasUI y generación antes/después del diálogo; no callback aportado por caller. `serializeResultReply(request:RpcRequest<'result'>,sessionId:string,data:RpcData['result']):RpcResponse<'result'>` ajusta solo text; metadata que sola no cabe produce error INVALID_REQUEST sanitizado, sin consumo adicional/reintento oculto.

Fixture `makeRpcFixture({runtime?,mode?,confirm?,timers?}={})` en `tests/helpers/rpc.mjs`: SQLite temporal+JobsService real para authority, fake runtime diferido para deadlines, bus con registro observable, constructor de envelopes válidos y cleanup idempotente. No fabricar éxito de servicios para pruebas de ledger/review.

- [ ] **1. Escribir tests rojos** para todas las operaciones: ping sin ready/sessionId, mismatch antes de resolver, versión errónea, IDs excesivos descartados sin respuesta, duplicado de correlación descartado sin segunda respuesta, review siempre prohibido, actor/cwd/confirmation forjados rechazados, policy extension, max reason 2048. Concurrencia y replay tras reopen mantienen receipt/eventos originales y nueva correlación; normalizar CONTROL_CONFLICT.

```js
assert.equal(confirmedControl.actor.kind, 'extension');
assert.equal(await countStoredEvents('job.cancel-requested'), 1);
assert.equal(JSON.stringify(resultReply).includes('SECRET_SENTINEL'), false);
assert.ok(Buffer.byteLength(JSON.stringify(resultReply)) <= 65536);
assert.equal(repliesForTimedOutAttempt.length, 1);
```

El centinela se ubica en campos prohibidos, no en finalResponse autorizado. Probar texto emoji/comillas/backslash/newlines y metadatos grandes; hash/totalBytes corresponden al texto completo y text termina en frontera Unicode válida. Status/list/wait no leen JobResultDocFamily. Confirmación tarda >30000 ms o cruza generación: no intención nueva. Lectura inicial queued pero Tx running: solicitar UI y reintentar **misma intención**, nunca actor human. Timeout después de commit: mismo requestId recupera recibo sin otro evento; no otra respuesta tardía. Wait=0/predicado cancelled/300 s y abort de generación no cancela job.
- [ ] **2. Ejecutar** `node --test tests/rpc-server.test.mjs tests/rpc-authority.test.mjs`; esperado FAIL por servidor ausente.
- [ ] **3. Implementar** handlers persistentes de ocho operaciones solo con runtime listo. Validar antes de invocar servicios. Usar getJob/listJobs/waitForJob/getResult/start/control/retry; no transiciones ni acceso a SQLite desde el adaptador. result consume usa el requestId del sobre. Control interno ACTIVE_CANCEL_CONFIRMATION_REQUIRED abre diálogo solo tras policy vigente y retorna CAPABILITY_UNAVAILABLE si no hay consentimiento/UI; comprobar vigencia del intento antes de volver a admitir. Replay no abre un nuevo diálogo. Hacer truncación por búsqueda del prefijo que cabe según JSON.stringify del sobre completo, sin cortar pares sustitutos ni UTF-8; SHA-256 sobre UTF-8 completo. Proyectar también receipt/state internos con estados públicos.
- [ ] **4. Implementar** registro temporal de correlaciones, deadlines 5000/30000 ms, timer de wait según timeoutSeconds (default 300), AbortController por espera/intento y respuesta única. Durante seal responder RPC_SHUTTING_DOWN solo a nuevas llamadas mientras endpoint siga registrado; callbacks previos no publican después de invalidación. close retira ocho listeners y limpia correlaciones/timers; no cancelar mutaciones ya admitidas ni jobs. Log local solo código, sin request/paths. Ready y ping usan misma discovery con capacidades reales y versión de package. Integrar en register el hook onOpen de T7: registrar servidor, anunciar ready y arrancar emisor de T6, en ese orden; devolver cleanup que sella/cierra servidor y detiene emisor antes de cerrar runtime.
- [ ] **5. Ejecutar** tests nuevos, `npm test`, `npm run check`; esperado código 0.
- [ ] **6. Commit** `feat: serve trusted-extension RPC with deadlines and human control gates` con los seis archivos indicados.

## Task 9: Cliente público, integración caller y gates de aceptación (AC-15–17)

**Files:** crear `rpc.ts`, `src/public/rpc-client.ts`, `tests/fixtures/rpc-caller-extension.ts`, `tests/rpc-client.test.mjs`, `tests/rpc-integration.test.mjs`, `tests/phase-03-acceptance.test.mjs`, `docs/RPC.md`, `docs/PHASE-03-ACCEPTANCE.md`; modificar `package.json`, `tsconfig.json`, `scripts/check-syntax.mjs`, `README.md`, `docs/ARCHITECTURE.md`, `specs/ROADMAP.md`.

**Interfaces:** root `rpc.ts` reexporta solo contratos/client/event types; package.files incorpora `rpc.ts`. No introducir exports restrictivos que rompan entrypoints previos. `createRpcClient(options:{bus:EventBusLike,callerId:string,sessionId?:string,timers?:TimerApi,createCorrelationId?:()=>string}):{call<O extends RpcOperation>(operation:O,params:RpcParams[O],options:{requestId:string,timeoutMs?:number}):Promise<RpcResponse<O>>;close():void}`. Cliente valida reply, instala listener antes de emit y limpia siempre; errores de transporte locales no se confunden con respuesta servidor. Timeout caller por defecto: 6000 ms query, 31000 ms mutación, `(timeoutSeconds??300)*1000+1000` wait. No reintentar mutaciones automáticamente. Ping exitoso fija sesión explícita del cliente; un mismatch exige nuevo descubrimiento decidido por caller, no redirección silenciosa.

- [ ] **1. Escribir tests rojos**: respuesta síncrona capturada, correlation/requestId/session/operation incorrectos ignorados, timeout y close quitan listener, requestId constante/correlation nueva al reintentar. Caller de fixture importa exclusivamente `rpc.ts`, deduplica eventos por `(sessionId,eventId)`, consulta status/list cuando procede y limpia suscripciones en shutdown. Bus con listeners `subagents:*` no recibe nuestras emisiones; describirlo solo como aislamiento de nombres, no convivencia upstream real.

```js
assert.equal(bus.listenerCount(replyChannel('status', correlation)), 0);
assert.equal(new Set(seenEventIds).size, logicalEvents.length);
assert.equal(upstreamDeliveries.length, 0);
assert.equal(await storedConsumptionCount(), 1);
```

Prueba documental valida que AC-01..17 estén registrados y ningún gate pendiente sea presentado como aprobado. La integración de autoridad usa runtime/SQLite real y caller, sin llamadas directas al repositorio salvo preparación/verificación de fixtures.
- [ ] **2. Ejecutar** `node --test tests/rpc-client.test.mjs tests/rpc-integration.test.mjs tests/phase-03-acceptance.test.mjs`; esperado FAIL por cliente/artefactos ausentes.
- [ ] **3. Implementar** cliente y fixture sin depender de servicios internos; documentar sobres/DTO exactos, errores, discovery, deadlines, Unicode/escaping, retries con mismo requestId, dedup, caller declarativo, reintentos de emisión con posibles duplicados y retención solo de índice. Incluir `rpc.ts` y la fixture TS en el type-check, y `rpc.ts` en check-syntax; no dejar el entrypoint nuevo fuera de los gates. README/arquitectura describen únicamente lo ya implementado. Acceptance inicia con revisión/TUI **pendientes**; roadmap fase 03 en validación, nunca completada por tests automáticos.
- [ ] **4. Ejecutar gates finales** `npm run check`, `npm test`, `git diff --check`, `npm pack --dry-run --json` y `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models '__phase03_smoke_no_model__'`. Esperado código 0; package incluye rpc.ts y no SQLite/backups/.pi/.cache/.worktrees. Smoke acredita carga, no aceptación TUI ni llamadas RPC. Registrar commit/entorno/comandos/resultados reales; ninguna cifra prevista se toma como medición.
- [ ] **5. Commit** `feat: publish RPC caller API and phase 03 acceptance gates` con los archivos de esta tarea.
- [ ] **6. Pedir revisión independiente** conforme a `requesting-code-review`, sobre diff completo de fase 03. Si el tooling exige autorización humana para obtener verdict, solicitarla; nunca inferirlo de estado completed. Corregir findings y volver a correr gates antes de solicitar aceptación.
- [ ] **7. Solicitar autorización para TUI humana** desde cwd no relacionado y con copia válida de schema 4, sin migrar la base real automáticamente. Probar caller tardío/ping, spawned job propiedad extension, cancel queued, cancel activo aprobado/rechazado/timeout y race, pausa activa rechazada, review RPC prohibido, aprobación humana habilita resultado/consumo, reopen y migración aceptada/declinada. Registrar fuente de fixtures y evidencia real; no fabricar transcripciones.
- [ ] **8. Registrar aceptación humana** solo tras confirmación explícita; actualizar roadmap/acceptance a completada o mantener pendientes con limitaciones. Revalidar integración/promoción según `finishing-a-development-branch` después de gates verdes; no merge/push implícito.

## Cobertura y revisión del plan

| Criterios de la spec | Tareas propietarias |
| --- | --- |
| AC-03-01 / 02 | T1, T7, T8 |
| AC-03-03 / 04 | T2, T3, T4, T8 |
| AC-03-05 / 06 | T2, T3, T6 |
| AC-03-07 / 08 | T1, T4, T8 |
| AC-03-09 / 10 | T4, T8 |
| AC-03-11 / 12 | T6, T7, T8, T9 |
| AC-03-13 / 14 | T1, T3, T5, T8 |
| AC-03-15 / 16 / 17 | T9 |

Self-review realizada antes de handoff: cobertura de las secciones de spec y AC-03-01..17, interfaces/DTO/códigos entre tareas, pasos accionables y tests para las cinco clases de Review Focus. Se corrigieron callsites de sessionId en T3, tests de migraciones escalonadas en T5, ownership del hook ready/emisor en T8 y gates del entrypoint público en T9. La validación estructural de links/tablas/fences se registra aparte; no equivale a ejecutar tests de fase 03. Las tareas comparten las interfaces del mapa; cualquier cambio durante implementación requiere actualizar consumidores y tests conjuntamente, no inventar una segunda API.

## Handoff humano

El usuario aprobó el plan y eligió ejecución con subagentes. Opciones presentadas durante el handoff:

- **Subagent-driven (recomendado):** implementador y reviewer nuevos por tarea, más revisión completa final; más coste/contextos, gates independientes tempranos para atomicidad, autoridad y lifecycle.
- **Native:** implementación en esta sesión con gates por tarea y una revisión independiente final; menor coste, sin revisión independiente intermedia.

Método elegido: subagent-driven; emplear la última implementación integrada de pi-durable-subagents desde el checkout principal, no la extensión del worktree phase-02 ni el código phase-03 en desarrollo. Conservar los gates humanos para recuperar resultados y revisiones. Si no se puede operar el worktree autorizado o recuperar un verdict autorizado, registrar el bloqueo; no cambiar de método ni inferir aprobación.
