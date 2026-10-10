# Comunicación durable padre-hijos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar al padre Pi autenticado un aviso durable y acotado por cada hijo directo terminal, con lectura autorizada del informe completo por tramos sin alterar consumo ni revisión.

**Architecture:** Persistir el vínculo confiable padre-sesión y una outbox privada en el mismo SQLite y commit que admite/finaliza jobs; mantener separados ACK de entrega, notificación TUI, consumo y revisión. Un dispatcher asociado al runtime Pi reanuda pendientes, reconcilia el historial público de la sesión y envía mensajes acotados; la tool existente `pi_agents_result` verifica el vínculo y pagina el resultado durable. Migración humana vacía de entregas históricas; ninguna entrega retroactiva.

**Tech Stack:** TypeScript estricto, Node `26.10.0`, Pi API pública (baseline local inspeccionada: `1.1.0`), Pi Durable/Chord existentes y `node:test`; sin dependencias nuevas.

**Spec:** [`../specs/2026-10-08-comunicacion-padre-hijos-design.md`](../specs/2026-10-08-comunicacion-padre-hijos-design.md), aprobada por el usuario el 2026-10-08. Refina [`001-consulta-listado-espera/spec.md`](../../../specs/001-consulta-listado-espera/spec.md). Los cambios de fase 03 no se vuelven a especificar aquí.

**Estado:** Plan aprobado por el usuario el 2026-10-08. **No ejecutar ninguna tarea hasta que T4 de fase 03 haya sido cerrada y aceptada mediante su gate independiente.** La aprobación de este plan no autoriza implementación, migración real, publicación o promoción.

## Global Constraints

- Solo una admisión nueva desde `pi_agents` recibe `parentSessionId`, capturado del contexto Pi confiable; no se acepta por parámetros de tool/RPC, tarea, resultado, `callerId`, cwd ni `createdBy.kind`.
- El padre es el ID de la sesión Pi completa, no una rama. Verificar el contexto recibido contra el vínculo durable del job; sin coincidencia no hay excepción de lectura.
- La excepción del padre es solo `peek`, incluidos estados de revisión `pending` y `rejected`; motivo y estado se muestran como dato no confiable. No crea consumo, aprobación, promoción ni permiso de control.
- Entrega/lectura por partes no emite `job.consumed`, no muta ledger/revisión y no modifica `notified` ni la outbox pública de eventos. `consume` mantiene sus gates actuales.
- Outbox privada transaccional y entrega al menos una vez; no prometer `exactly once`. `deliveryId` estable permite reconocer duplicados.
- Mensaje automático y cada respuesta por tramos: máximo **65536 bytes UTF-8 de contenido textual total**, incluidos sobre, advertencias y delimitadores. Los offsets cuentan bytes UTF-8 y nunca dividen un carácter.
- Usar solo API Pi pública; validar persistencia vía historial, no confiar en `sendMessage()` ni en `message_end` como ACK. No importar internals del host.
- Jobs preexistentes, RPC, comandos humanos y retry sin contexto confiable no adquieren vínculo ni generan entregas retroactivas. No cambiar contratos RPC, permisos de aprobación/control, dependencias ni instalar tooling.
- Migración con backup, lease y confirmación humana existentes. Determinar el siguiente número de esquema libre **solo después de aceptar T4**; no reescribir migraciones aceptadas ni migrar datos reales durante estas tareas.
- Compartir cwd/filesystem no es aislamiento de seguridad. El vínculo protege las rutas de producto; no promete protección frente a extensiones maliciosas o procesos con acceso al SQLite/historial.

## Review Focus

1. Repetir una admisión idempotente con el mismo `requestId` y otro contexto padre: rechazar conflicto; nunca reasignar el vínculo (Tarea 1).
2. Cancelar en cola/pausa o fallar provisioning/submit: estado terminal y outbox se confirman juntos; cancelación no filtra cuerpo ni pasa `RESULT_NOT_READY` (Tarea 2).
3. Unicode, texto vacío, JSON escapado y offsets en bytes: cada página queda bajo 65536 bytes y concatenar páginas produce exactamente el texto/hash originales (Tarea 3).
4. `message_end` antes del append, caída tras append antes de ACK y cambio/reload de sesión durante una promesa: reconciliar sin confirmar antes de tiempo ni enviar/confirmar en sesión nueva (Tarea 4).
5. Rechazo humano ocurrido después de una entrega: el padre sigue pudiendo leer por peek el resultado atribuido y motivo actuales; ningún caller ajeno ni RPC obtiene el cuerpo (Tareas 1, 3 y 5).

## Mapa de archivos

| Unidad | Rutas que cambian | Responsabilidad |
|---|---|---|
| Identidad y autorización | `src/domain/jobs.ts`, `src/application/start.ts`, `src/application/result.ts`, `src/application/jobs.ts`, `src/infrastructure/durable/repository.ts`, `src/adapters/pi/register.ts` | Persistir vínculo solo desde tool confiable, incluirlo en idempotencia, verificar autoridad y leer el resultado coherente. |
| Outbox privada | `src/infrastructure/durable/documents.ts`, nuevo `src/infrastructure/durable/parent-delivery.ts`, `src/infrastructure/durable/repository.ts` | Recibo/índice pendientes privados y escritura atómica desde todas las transiciones terminales. No reutilizar ACK de outbox RPC. |
| Mensaje/paginación | `src/adapters/pi/display.ts`, `src/adapters/pi/register.ts`, `src/application/result.ts` si el contrato interno lo requiere | Formateo acotado, metadatos de revisión y cursor byte UTF-8 para el padre verificado. Sin nueva tool. |
| Runtime Pi | `src/runtime/session.ts`, nuevo `src/adapters/pi/parent-delivery.ts`, `src/adapters/pi/register.ts` | Dispatcher por runtime, reanudación/reconciliación por historial, ciclo de vida de sesión y reintentos limitados. |
| Esquema | `src/infrastructure/durable/documents.ts`, `src/infrastructure/storage/inspect.ts`, `migrate.ts`, `src/application/maintenance.ts`, `src/runtime/session.ts` | Próximo esquema tras T4, migración con aprobación/backup, rechazo de esquemas incompatibles. |
| Verificación/documentación | Tests focales existentes y nuevos bajo `tests/`; `specs/01-consulta-listado-espera.md`, `specs/README.md`, README de uso | Pruebas de regresión e integración Pi, actualizar estado objetivo frente a runtime aceptado. |

No dividir `register.ts` existente ni añadir broker, framework de mensajería o nueva infraestructura externa.

---

### Tarea 1: Vínculo confiable y lectura autorizada por sesión

**Files:**
- Modify: `src/domain/jobs.ts`
- Modify: `src/application/start.ts`, `src/application/jobs.ts`, `src/application/result.ts`
- Modify: `src/infrastructure/durable/repository.ts`
- Modify: `src/adapters/pi/register.ts`
- Test: `tests/start-service.test.mjs`, `tests/review-consume.test.mjs`, `tests/pi-query-adapters.test.mjs`; crear `tests/parent-access.test.mjs`

**Interfaces:**
- Add optional `JobRecord.parentSessionId?: string`; `assertJob` valida string no vacío cuando está presente. La identidad no es un campo de `StartRequest`, RPC ni parámetros del modelo.
- Interfaces exactas: `StartService.start(request: StartRequest, resolve: ResolveInput, parentSessionId?: string): Promise<Outcome<AdmissionReceipt>>`; `canonicalStart(request: StartRequest, parentSessionId?: string)` incorpora el padre al hash solo cuando está presente; `JobRepository.admit(request: StartRequest & { payloadHash: string }, input: Omit<JobRecord, "id" | "status" | "createdAt" | "updatedAt" | "notified">, parentSessionId?: string): Promise<AdmissionReceipt>`. El tercer argumento se persiste en el job nuevo dentro de la transacción de admisión. Pi `pi_agents` pasa `ctx.sessionManager.getSessionId()` como tercer argumento; el comando humano no lo pasa.
- Replay con distinto padre da `REQUEST_ID_CONFLICT`; receipts históricos y callers sin vínculo conservan interpretación previa. `retry` no copia `parentSessionId`.
- Definir `ParentSessionAccess={sessionId:string}` en `src/domain/jobs.ts`. Extender `JobsService.getResult(id, access, parent?: ParentSessionAccess)` y `ResultService.getResult(id, access, parent?: ParentSessionAccess)`; el adaptador deriva `parent` de `ExtensionContext`, nunca de `params`.
- Extender `JobRepository.readAuthorizedResult(id: string, access: ResultAccess, parent?: ParentSessionAccess): Promise<ResultView>`; solo `operation:"peek"` puede incluir `parent`. Valida en el mismo commit Durable: vínculo con la sesión indicada, estado con resultado, resultado durable y revisión vigente. Un parent+consume se rechaza antes de mutar. No relajar la lectura normal `mode: "tool"`.

- [ ] **Paso 1: Escribir tests rojos.** Cubrir tool Pi vinculada, comandos/RPC/jobs antiguos sin vínculo, caller con sesión distinta, `pending` y `rejected`, vínculo no derivado de actor/cwd/tarea, replay con mismo/diferente padre y retry sin herencia. Verificar que peek no escribe consumo, ledger ni revisión.
- [ ] **Paso 2: Verificar rojo.** `node --test tests/parent-access.test.mjs tests/start-service.test.mjs tests/review-consume.test.mjs`; esperado: falla por ausencia de vínculo/autorización padre.
- [ ] **Paso 3: Implementar** el vínculo como parámetro interno confiable separado de la intención pública; calcular idempotencia con vínculo; validar lectura y snapshot de revisión/cuerpo en la misma transacción.
- [ ] **Paso 4: Verificar verde.** Repetir pruebas focales, `node --test tests/pi-query-adapters.test.mjs` y `npm run check`; esperado: código 0, RPC y callers no-parent aún bloqueados en revisión restringida.
- [ ] **Paso 5: Commit.** `feat: bind child jobs to verified Pi parent sessions`.

### Tarea 2: Outbox privada y finalización atómica

**Files:**
- Modify: `src/infrastructure/durable/documents.ts`, `src/infrastructure/durable/repository.ts`
- Create: `src/infrastructure/durable/parent-delivery.ts`
- Test: `tests/helpers/store.mjs`; crear `tests/parent-delivery-outbox.test.mjs`
- Extender: pruebas actuales de jobs, cancelación y recuperación según llamadas reales al repositorio

**Interfaces:**
- Nuevo `ParentDeliveryDocFamily(jobId)` con `deliveryId`, `jobId`, `parentSessionId`, `createdAt`, `state: "pending" | "delivered"`, y recibo opcional `deliveredAt`/`sessionEntryId`; documento/índice pendiente privado. ID determinista/versionado del par `(parentSessionId, jobId)`.
- Métodos exactos de repositorio `pendingParentDeliveries(limit:number):Promise<ParentDelivery[]>` y `markParentDelivered(jobId:string, deliveryId:string, sessionEntryId:string, at:number):Promise<void>` con confirmación idempotente y validación de identidad/estado.
- `ParentDeliveryIndexDoc` conserva referencias pendientes paginables; al confirmar se retira solo la referencia activa y se conserva el recibo `delivered`. Ayudante privado `recordParentDelivery(tx, job, at):Promise<void>`: no-op sin vínculo; escribe solo referencia, nunca copia resultado ni lo emite por RPC.
- Escribir pendiente en el mismo `tx` que cada transición terminal: `finish`, `finishCancelled` y cancelación queued/paused dentro de `applyControl`. Fallos de provisioning/submit terminan vía `finish`; verificarlo en tests del coordinator. `claimNext` fallido revierte el commit y no deja job terminal parcial.

- [ ] **Paso 1: Escribir tests rojos** con SQLite temporal: transición terminal vinculada deja exactamente una entrega; sin vínculo no deja entrega; repeated finish/cancel/replay no duplica; canceled solo marca resultado no disponible; submit/provisioning error llega a finish; rollback de commit no deja job/outbox parcial; reopened DB conserva pendiente.
- [ ] **Paso 2: Verificar rojo.** `node --test tests/parent-delivery-outbox.test.mjs tests/coordinator.test.mjs`; esperado: falla por API/documento nuevo ausente.
- [ ] **Paso 3: Implementar** outbox privada dentro de Durable y agregar la escritura al mismo commit efectivo de cada finalización/cancelación; preservar el documento recibido al confirmar y no tocar outbox de eventos, `notified`, revisión ni consumo.
- [ ] **Paso 4: Verificar verde.** Repetir focales y `node --test tests/repository.test.mjs tests/recovery.test.mjs`; esperado: atomicidad tras reopen y suite focal sin duplicados.
- [ ] **Paso 5: Commit.** `feat: persist parent result deliveries atomically`.

### Tarea 3: Lectura `peek` por tramos y mensaje no confiable acotado

**Files:**
- Modify: `src/adapters/pi/display.ts`, `src/adapters/pi/register.ts`
- Modify `src/application/result.ts` o `src/domain/jobs.ts` únicamente si el tipo validado de paginación debe compartirse
- Test: crear `tests/parent-result-format.test.mjs`; extender `tests/pi-query-adapters.test.mjs`, `tests/review-consume.test.mjs`

**Interfaces:**
- Extender parámetros internos de `pi_agents_result` con `offset?: number`; sin cambiar parámetros ni contratos RPC. Sin `offset`, conservar el comportamiento existente para caller no-parent; para padre devolver primer tramo con metadatos completos.
- Agregar validación de `offset`: entero seguro, no negativo, menor/igual a `totalBytes`, en frontera UTF-8; `offset` junto con `consume` se rechaza antes de leer/mutar. Si offset no se proporciona, aplicar el límite existente.
- Implementar helper de display `formatParentResult(view, {deliveryId, offset?})` o equivalente: calcula SHA-256 y byte length del texto completo; serializa el sobre y selecciona el mayor fragmento UTF-8 que cabe en **65536 bytes totales**, con `offset`, `nextOffset`, `truncated`, estado técnico/revisión/motivo y advertencia no confiable. `details` contiene solo correlación/renderizado, nunca el cuerpo oculto.
- `cancelled` y resultados sin texto exponen solo estado/`hasResult:false`; no filtrar error interno. Cada página relee estado/revisión actuales; no permitir mezclar hashes/jobs.

- [ ] **Paso 1: Escribir tests rojos** para ASCII/Unicode, comillas, slash, saltos, texto vacío, resultado >64 KiB, metadata larga, offsets final/interior/medio carácter/negativo/fraccional/inseguro/fuera de rango y offset+consume. Concatenar páginas debe reproducir exactamente el string y hash; cada respuesta completa ≤65536 bytes. Assert de cero cambios en consumo/ledger/revisión.
- [ ] **Paso 2: Verificar rojo.** `node --test tests/parent-result-format.test.mjs`; esperado: formatter/paginación nueva ausente.
- [ ] **Paso 3: Implementar** empaquetado acotado y slicing por bytes UTF-8 con validación previa a toda mutación; incluir sobre y aviso dentro del límite, truncar únicamente descripciones no esenciales con indicador.
- [ ] **Paso 4: Verificar verde.** Prueba focal, `node --test tests/pi-query-adapters.test.mjs tests/review-consume.test.mjs` y `npm run check`; esperado: límites exactos y gates actuales intactos.
- [ ] **Paso 5: Commit.** `feat: page trusted parent result reads within message limits`.

### Tarea 4: Dispatcher durable y ciclo de vida Pi

**Files:**
- Modify: `src/runtime/session.ts`, `src/adapters/pi/register.ts`
- Create: `src/adapters/pi/parent-delivery.ts`
- Test: crear `tests/parent-delivery-dispatcher.test.mjs`; extender los tests de adaptador/runtime existentes

**Interfaces:**
- Definir `ParentDelivery` como `{deliveryId:string; jobId:string; parentSessionId:string; createdAt:number; state:"pending"|"delivered"; deliveredAt?:number; sessionEntryId?:string}`.
- `createParentDeliveryDispatcher(options: { listPending(limit:number):Promise<ParentDelivery[]>; buildMessage(delivery:ParentDelivery):Promise<{content:string;customType:"pi-agents-parent-result";display:true;details:Record<string,string>}>; confirm(delivery:ParentDelivery,entryId:string):Promise<void>; sendMessage(content:string,options:{triggerTurn:true;deliverAs:"followUp"}):void; getSessionId():string; getEntries():readonly SessionEntry[]; isActive():boolean; report(error:unknown):void; clock:Clock; setTimer(handler:()=>void,ms:number):unknown; clearTimer(handle:unknown):void })` devuelve `{start():Promise<void>; wake():void; stop():Promise<void>}`. Mantener estos límites; `buildMessage` realiza la lectura autorizada y no acepta IDs desde el modelo.
- Un dispatcher por estado/runtime de Pi. Antes de enviar, `getSessionId()` debe coincidir con `delivery.parentSessionId`; `sendMessage` usa `{triggerTurn:true,deliverAs:"followUp"}`. Un envío en vuelo; no interrumpir turno activo. Validar identidad de sesión/runtime tras cada await y antes de enviar/confirmar.
- `getEntries()` es API pública. Correlacionar un `custom_message` de tipo `pi-agents-parent-result` por `deliveryId`, `jobId` y `parentSessionId`; el cuerpo del hijo no es ACK.
- `message_end` solo agenda reconciliación después del handler. La confirmación requiere que el custom entry sea visible en historial; nunca inferirla del retorno void.
- Arranque: snapshot de pendientes, observar finales/wake y releer para cerrar carrera. Cambio de sesión/shutdown: detener, cancelar timer, invalidar callback y limpiar listeners antes de cerrar runtime. No confirmar ni enviar con contexto obsoleto.
- Si Pi sigue ocupado, no reenviar por timeout. Tras idle, reconciliar/reintentar si falta entry. Un único timeout con backoff acotado 1–30 s para fallos; aborto humano pausa reenvío hasta siguiente interacción o reapertura. Sin archivo persistente: conservar pending y evitar loop.

- [ ] **Paso 1: Escribir tests rojos** de sesión inactiva inicia turno, sesión ocupada recibe followUp sin interrupción, llegada de 2 hijos se serializa, `message_end` antes de append no confirma, append visible sí confirma, crash entre append/SQLite ACK deduplica por historial, send failure deja pendiente, session switch/reload invalida callbacks, abort humano no entra en bucle, sesión sin archivo conserva pendiente sin loop, branch/fork no hereda vínculo/ACK, start/stop idempotente.
- [ ] **Paso 2: Verificar rojo.** `node --test tests/parent-delivery-dispatcher.test.mjs`; esperado: dispatcher nuevo ausente.
- [ ] **Paso 3: Implementar** dispatcher serial y recuperable; registrar lifecycle Pi al abrir/cerrar runtime sin tocar callbacks de la generación anterior ni compartir estado entre sesiones.
- [ ] **Paso 4: Verificar verde.** Focales y `node --test tests/pi-adapters.test.mjs tests/pi-query-adapters.test.mjs tests/session-runtime.test.mjs`; esperado: sin envío cruzado ni ACK anticipado.
- [ ] **Paso 5: Commit.** `feat: deliver durable child results to the active Pi parent`.

### Tarea 5: Migración, aceptación integral y documentación

**Files:**
- Modify: `src/infrastructure/durable/documents.ts`, `src/infrastructure/storage/inspect.ts`, `src/infrastructure/storage/migrate.ts`, `src/application/maintenance.ts`, `src/runtime/session.ts`, `src/adapters/pi/register.ts`
- Modify: `tests/migration-v3.test.mjs`, `tests/session-query-runtime.test.mjs`, `tests/session-control-runtime.test.mjs`; create `tests/migration-parent-delivery.test.mjs`
- Modify: `specs/01-consulta-listado-espera.md`, `specs/README.md`, README de uso

**Interfaces:**
- La inspección debe aceptar solo el esquema actual luego de T4 y el nuevo siguiente; la versión anterior rechaza el siguiente esquema. Fijar la versión exacta al inicio de esta tarea inspeccionando migraciones aceptadas y suites actuales; nunca reutilizar una versión.
- Extender `MaintenanceService.migrate` y el flujo de registro para llegar al nuevo esquema con la confirmación/backup humanos existentes. Mantener cada escalón antiguo e idempotencia del esquema ya vigente.
- Migración a nueva versión inicializa outbox privada vacía, deja `parentSessionId` ausente en todos los jobs (activos incluidos) y preserva ledger, resultado, revisión, consumo, cola, `notified` y outbox pública.

- [ ] **Paso 1: Escribir tests rojos** con fixture de la versión aceptada post-T4: approval/backup válidos migran sin pérdida y sin pendientes retrospectivos; decline, hash/backup incorrectos y actor no humano no mutan; versión anterior rechaza nueva; segunda migración es no-op. Mantener fixtures históricas 2→3→4→T4 y agregar solo el nuevo escalón.
- [ ] **Paso 2: Verificar rojo.** `node --test tests/migration-parent-delivery.test.mjs tests/migration-v3.test.mjs`; esperado: versión/documentos de migración ausentes.
- [ ] **Paso 3: Implementar** nuevo escalón transaccional con backup y autorización conforme al flujo existente; actualizar apertura de runtime y versión de fixtures actuales sin cambiar el significado de fixtures históricas.
- [ ] **Paso 4: Verificar verde e integral.** `node --test tests/migration-parent-delivery.test.mjs tests/migration-v3.test.mjs tests/session-query-runtime.test.mjs tests/session-control-runtime.test.mjs`, luego `npm test`, `npm run check` y `git diff --check`; todos deben terminar en código 0.
- [ ] **Paso 5: Realizar smoke test en Pi 1.1.0** con padre idle/busy, salida pending/rejected, >64 KiB y `/reload`/cambio de sesión. Registrar sesión/version, observaciones y límites; mock/test unitario no sustituye este gate. Si no hay host disponible, marcar aceptación interactiva pendiente, no afirmar aceptación completa.
- [ ] **Paso 6: Actualizar** los documentos para separar contrato objetivo y runtime efectivamente probado; no declarar T4 cerrada por esta aceptación.
- [ ] **Paso 7: Commit.** `feat: migrate and document durable parent result delivery` con solo esta tarea.

## Cobertura de aceptación

| Criterio del diseño | Tarea(s) que aportan evidencia |
|---|---|
| PH-01 admisión, vínculo y replay | 1 |
| PH-02 autoridad por sesión y revisión vigente | 1, 3 |
| PH-03 no mutación de consumo/ledger/revisión | 1, 3 |
| PH-04 outbox atómica en toda finalización/cancelación | 2 |
| PH-05 idle/ocupado y concurrencia serial | 4 |
| PH-06 crash windows, persistencia previa a ACK | 2, 4 |
| PH-07 reconciliación/duplicados estables | 4 |
| PH-08 cambio/reload/branch/fork según sesión | 4, 5 |
| PH-09 límite UTF-8/hash/paginación | 3 |
| PH-10 offsets inválidos/consume incompatible | 3 |
| PH-11 migración sin retroactividad | 5 |
| PH-12 interrupción humana y sesión sin persistencia | 4, 5 |
| PH-13 RPC, revisión, consumo, TUI/outbox actual | 1–5, suite integral |

## Revisión y ejecución posterior

Las tareas dependen en orden de sus contratos: autorización → persistencia atómica → formato/paginación → dispatcher → migración/aceptación. No despachar implementación hasta que: (1) el resultado protegido del fix T4 sea autorizado, cotejado y revisado independientemente; (2) T4 esté aceptada por decisión humana; (3) este plan reciba aprobación humana. Después, seguir el método acordado de subagentes con implementador y reviewer independientes por tarea y revisión final; cada gate puede detener la secuencia. Una suite verde o un reporte de agente no sustituye revisión ni aceptación humana.
