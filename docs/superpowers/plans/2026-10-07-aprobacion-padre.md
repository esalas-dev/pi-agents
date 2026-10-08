# Aprobación del padre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Autorizar revisión durable de resultados propios desde el agente principal sin atribuirle identidad humana ni abrir revisión RPC.

**Architecture:** Añadir procedencia host y una fachada parental interna sobre los servicios existentes. La referencia de autoridad emitida por el runtime, el vínculo persistente y la precedencia humana se verifican en la transacción; argumentos declarativos no conceden permiso. Reutilizar review/index/ledger y separar autorización de lectura, aceptación técnica y promoción.

**Tech Stack:** TypeScript, Node 26.10.0, Pi 1.0.4, Pi Durable/Chord 1.0.1, SQLite actual y node:test; sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-10-07-aprobacion-padre-design.md`: original aprobada en `9611a5c`; enmienda §3.1/PR-09 de `e1fcfec` aprobada por el usuario. Esta revisión del plan P3/P4 requiere conformidad escrita antes de implementar.

**Estado de continuación:** P1/P2 aceptadas técnicamente; P3 `332560c` no aceptada, con findings de lifecycle y cobertura abiertos. Trabajo exclusivo en `.worktrees/parent-review-dev`, rama `feat/parent-review-dev`; `.worktrees/parent-review` permanece instalada e intacta en `efe1615`. Método ya elegido: subagentes aislados y reviewers frescos, ambos `openai-codex/gpt-5.6-luna`. No reiniciar P1/P2 ni instalar candidatos por actualizar este plan.

## Global Constraints

Requisitos copiados literalmente de la especificación; no sustituir sus valores:

- «No se delega recursivamente: los workers Durable actuales reciben CodingTools y no reciben `pi_agents_review`, herramientas de aprobación ni un contexto nativo de padre.»
- «`createdBy` y el ID de tool call actuales se conservan.»
- «No cambia el hash canónico histórico de start: ownership es evidencia interna adicional, no parámetro del intent.»
- «No convierte al padre en human.»
- «No aprobar automáticamente al completar y no alterar el resultado ni su status de ejecución.»
- «Una decisión humana explícita toma precedencia: el padre no puede reemplazarla, ni siquiera con otro requestId, y un replay antiguo no restituye permiso retirado.»
- «Los jobs existentes no se rellenan, no se adopta ownership por escanear nombres/perfiles o instrucciones del agente.»
- «No reescribir recibos ni debilitar canonicalJson.»
- «RPC review sigue siempre prohibido operacionalmente, callerId sigue declarativo y `rpcReview:false`.»
- «No se ofrece downgrade con escritura».
- «Liberar el lease solamente después del cierre real satisfactorio del storage.»
- «Si el proveedor no termina, conservar recursos y lease; no hacer retry automático ni ocultar el fallo.»
- «No saltar `Harness.close()`, alterar SDK/dependencias ni usar `Promise.race` para liberar recursos anticipadamente.»

Entorno objetivo exacto: macOS arm64, Node26.10.0, Pi1.0.4 y Pi Durable1.0.1. Razón parental máxima2048 unidades UTF-16 (`string.length`). Estado no sandbox frente a filesystem/plugins hostiles. No instalar, migrar datos reales, push/merge/publicar ni modificar main; autorización de instalación/carga local separada.

## Review Focus

1. Humano confirma el mismo status que el padre: cambia la autoridad, no es un no-op que deje permiso al padre (P2).
2. Resolver devuelve parentSessionId falso o un request reconstruye el contexto: no instala vínculo ni concede permiso por igualdad de strings (P1/P2).
3. Replay de consumo con aprobación ya retirada: ningún resultado histórico sale por ledger antes de revisar permiso vigente (P2).
4. Retirada con resolver/modelo pendiente, write ya iniciado o apertura obsoleta: `retire()` drena escrituras sin esperar al modelo; `close()` conserva el lease hasta completar el SDK; otra base funciona y la misma base falla `STORAGE_BUSY` hasta poder reintentar, sin callbacks tardíos ni lifecycle envenenado (P3).
5. Retry con toolCallId nuevo: reconocer procedencia parental propia solo para retry autorizado, no ampliar otros controles ni heredar permiso a human/extension (P1/P3).

## Workspace, preparación y gates

- Preparación original completada desde `98a1922` (bootstrap revisado). Continuación autorizada en `.worktrees/parent-review-dev`, rama `feat/parent-review-dev`, creada desde `efe1615` para no modificar el paquete instalado. Dependencias APFS y perfiles ya preparados; no crear otro worktree, reinstalar ni cambiar perfiles/settings. Registrar BASE completo antes de cada fix; conservar historia, commits documentales y evidencia SDD. No ejecutar en phase-03 ni copiar código no aceptado.
- Dependencias existentes: clonar APFS con `cp -cR ../fix-subagent-bootstrap/node_modules ./node_modules` si no existen aquí; sin npm install/ci. Verificar versiones reales, `npm run check`, `npm test`, diff-check y guardar baseline. Si falta una dependencia o falla baseline, BLOCKED con causa, no inventar setup alternativo.
- Método conservado: subagentes aislados, tareas secuenciales TDD y reviewers frescos; revisión final de rama. Preparar perfiles nuevos `parent-review-implementer` (read/write/edit/bash) y `parent-review-reviewer` (read/bash/write), ambos explícitamente `openai-codex/gpt-5.6-luna`, SOLO este worktree; no reutilizar perfiles restringidos a phase-03. Conservar settings y perfiles existentes. Sin approvals/tools de agentes en los workers.
- Skill TDD absoluta: `/Users/esalas/.pi/agent/git/github.com/obra/superpowers/skills/test-driven-development/SKILL.md`. Reviewer usa packaged diff exacto y covering tests/logs, no crawl ni rerun suite registrada. Fixes por scoped re-review desde último HEAD revisado, máximo5 rondas antes de escalar.
- Todo por tarea: BASE, HEAD, brief, logs RED/GREEN/check, report append y review. Nunca leer REPORT_FILE alrededor de un gate de resultado. Mientras el paquete actual no incluya la función, esos gates siguen humanos; planificar no desbloquea retrospectivamente jobs viejos.

## Mapa de archivos / contratos compartidos

- `src/domain/requests.ts`: ParentAuthority, actor/recibo/ledger aditivos; tipos internos, no nuevas credenciales JSON.
- `src/domain/jobs.ts`: vínculo opcional y tipo ParentReviewDecision; mantener ReviewDecision humano existente.
- `src/infrastructure/durable/documents.ts`: auditoría de review opcional; no schema nuevo.
- `src/infrastructure/durable/repository.ts`: identidad de referencia, ownership/admisión/retry, política review/replay/no-op y drenaje parental.
- `src/application/start.ts`, `control.ts`, `review.ts`, `result.ts`, `jobs.ts`: plumbing y política; métodos genéricos no conceden autoridad parental por actor model.
- Crear `src/application/parent.ts`: fachada nativa sobre start/retry/review. No nueva cola, DSL ni política configurable.
- `src/runtime/session.ts`, `coordinator.ts`, `src/adapters/pi/register.ts`, `display.ts`: contexto real, invalidación/sellado, herramienta y presentación.
- Tests nuevos indicados por tarea; reutilizar `tests/helpers/store.mjs`. `tests/helpers/runtime.mjs` NO existe en esta base y no debe usarse por suponerlo presente.
- README/ARCHITECTURE y aceptación separada de pruebas offline/host/fase03. Package ya incluye src/docs; no alterar manifests ni lockfiles por este cambio.

### Task 1: P1 — Persistir procedencia nativa y conservarla sin adopción por replay

**Files:** Modify requests.ts/jobs.ts, repository.ts, application/start.ts y control.ts; Modify `tests/helpers/store.mjs`; Create `tests/parent-admission.test.mjs`. Paths de src según mapa.

**Interfaces:**
- `ParentAuthority = Readonly<{ sessionId: string; isActive(): boolean }>` en requests.ts, objeto interno no serializable ni parámetro de tool/RPC. El constructor de repository recibe su referencia opcional como quinto argumento; solo esa referencia exacta es válida. No exportar una función que valide autoridad por comparar sessionId de un objeto recibido.
- `createJobRepository(session, context, clock, createId, parentAuthority?: ParentAuthority): JobRepository` conserva cuatro args existentes.
- `JobRecord.parentSessionId?: string`, `RequestRecord.parentSessionId?: string`.
- `repository.admit(request: StartRequest & {payloadHash: string}, input: Omit<JobRecord, 'id'|'status'|'createdAt'|'updatedAt'|'notified'>, parent?: ParentAuthority): Promise<AdmissionReceipt>`; `receipt(requestId: string, parent?: ParentAuthority): Promise<RequestRecord | undefined>`; `retry(id: string, request: RetryRequest, at: number, parent?: ParentAuthority): Promise<RetryReceipt>`.
- `StartService.start(request, resolve, parent?: ParentAuthority)` y `ControlService.retry(id, request, parent?: ParentAuthority)`; API JobsService genérica conserva ausencia de contexto parental.
- `repository.sealParent(): void`, `drainParent(): Promise<void>`: admitir/drenar SOLO operaciones de storage con contexto parental, no provider/model/resolve. Referencia inválida→INVALID_REQUEST; autoridad sellada→RUNTIME_CLOSING. No wait sobre resolver.

- [ ] **1. Escribir negativos y positivos persistentes** en parent-admission.test.mjs, adaptando el store fixture para recibir ParentAuthority y pasarla al constructor. Usar request/input de start-service y helpers actuales, no otro framework.

```js
assert.equal((await fixture.repository.get(receipt.jobId)).parentSessionId, 's1');
assert.equal((await fixture.repository.receipt('start:1')).parentSessionId, 's1');
assert.deepEqual(stored.createdBy, {kind:'model', id:'call:1'});
assert.equal(genericJob.parentSessionId, undefined); // human, extension y model sin referencia
assert.equal(legacyAfterReplay.parentSessionId, undefined);
assert.equal(foreignOrCopiedAuthority.error.code, 'INVALID_REQUEST');
```

Añadir tests nombrados «resolver no introduce ownership», «replay no reasigna vínculo ni altera hash», «retry parental con tool call distinto conserva ownership autorizado», «retry humano/extension no hereda vínculo» y «sesión sellada no admite después de resolver». Snapshot antes/después demuestra cero escrituras en denegaciones. Comparar hash previo a activar contexto parental y con contexto: mismo canonicalStart. Una referencia copiada `{...authority}` no es la referencia emitida.

- [ ] **2. RED:** `node --test tests/parent-admission.test.mjs`; fallos en vínculo/guards, no solo import/fixture roto. Guardar p1-red.log.
- [ ] **3. Implementar los contratos anteriores**. Limpiar parentSessionId recibido en request/input, instalar solo desde referencia autorizada model activa y persistir vínculo de job/ledger en la misma admisión. Fast-path de StartService.receipt aplica evidencia del contexto y no adopta registros antiguos; incluir ese await y sus nuevas denegaciones dentro del catch que convierte errores en Outcome. Retry con referencia válida comprueba fuente propia dentro del commit; solo en ese camino puede sustituir la comparación de toolCallId de defaultControlPolicy. Sin referencia, política actual intacta y nuevo retry no copia parentSessionId. Tracking solo del tramo de storage; después de seal no entran operaciones nuevas.
- [ ] **4. GREEN:** `node --test tests/parent-admission.test.mjs tests/start-service.test.mjs tests/retry.test.mjs tests/control.test.mjs`; `npm run check`; `git diff --check`. Logs reales p1-green/check. Si replay de start sigue fuera de transacción, debe revalidar autoridad al acabar el read y conservar vínculo inmutable; no declarar propiedad a partir de un ledger legacy.
- [ ] **5. Commit** solo Files P1: `feat: record trusted native parent provenance`; report/packaged BASE..HEAD/review independiente; no P2 hasta gate.

### Task 2: P2 — Revisar con autoridad parental, precedencia humana y acceso vigente

**Files:** Modify jobs.ts/requests.ts/documents.ts/repository.ts, application/review.ts y result.ts si el guard compartido lo requiere; Create `tests/parent-review.test.mjs`; Modify `tests/review-consume.test.mjs` para regresión de replay. No modificar herramientas aún.

**Interfaces:**
- `ParentReviewRequest = { requestId: string; status: 'approved'|'rejected'; reason?: string }` sin actor. Aclaración de implementación P2 aceptada: el tipo existente `ParentReviewDecision` conserva esa forma sin actor; ReviewService genera internamente `{kind:'model';id:string}` desde la referencia parental antes de llamar al repository. P3 reutiliza el tipo sin cambiar dominio ni aceptar identidad pública.
- `ReviewService.decideReview(id, decision: ReviewDecision | ParentReviewDecision, parent?: ParentAuthority): Promise<Outcome<ReviewReceipt>>`; repository equivalente recibe `at` y contexto opcional. JobsService.decideReview sigue siendo humano y nunca pasa referencia.
- `ReviewReceipt.decidedByActor?` y `JobReviewDocument.decidedByActor?`: actor human/model opcional; conservar decidedBy y lectura de históricos.
- Referencia P1 + job.parentSessionId exacto + actor.id=`parent:${sessionId}` + completed/failed/interrupted con body recuperable + permiso vigente, todo comprobado en el commit antes del replay y antes de escribir.

- [ ] **1. Escribir tests** con fixture P1 y jobs completados/result de review-consume. Casos «padre own approve/reject», «failed con resultado no implica éxito», «actor model genérico no basta», «authority copiada/ajena/sealed/legacy sin vínculo», «no resultado», «reason ausente/2048/2049», «status/actor/job/reason distintos en mismo ID», «reopen conserva recibo», «rollback no deja review/index/ledger».

```js
assert.equal(approved.value.decidedByActor.kind, 'model');
assert.equal(approved.value.decidedByActor.id, 'parent:s1');
assert.equal((await getToolResult()).success, true);
assert.equal(afterParentReject.error.code, 'RESULT_REJECTED');
assert.deepEqual(replay, approved); // solo con permiso vigente
assert.equal(parentAfterHumanDecision.error.code, 'INVALID_REQUEST');
assert.equal(staleConsumeReplay.error.code, 'RESULT_REJECTED');
```

Tests críticos adicionales: humano aprueba MISMO status del padre→decidedByActor human y bloquea siguiente decisión parental; same-status/mismo autor parental con ID nuevo→review conserva fecha/autor/motivo, ledger nuevo y ningún cambio efectivo; legacy approved/rejected sin decidedByActor se considera humano. Usar request de conflicto con envelope válido, no fixture rechazado por otro campo.

- [ ] **2. RED:** `node --test tests/parent-review.test.mjs tests/review-consume.test.mjs`; guardar p2-red.log con la causa del fallo correspondiente.
- [ ] **3. Implementar guards y transacción legibles**. Modelo sin referencia no pasa ni llamando directamente al repository. Validar shape/tipos/reason parental, sin reescribir serialización o recibos humanos históricos. No-op significa misma decisión **y misma autoridad**: la confirmación humana de un status parental es un cambio efectivo de autoridad, no no-op. Ledger nuevo de no-op usa requestId nuevo y estado/auditoría vigentes; no inventar otra decidedAt. Ownership y precedente humano se revisan antes de regresar un recibo antiguo. En consume, mover el check de review vigente antes del replay que contiene cuerpo (hoy está después): mantener la política existente, no abrir una excepción humana nueva.
- [ ] **4. GREEN:** `node --test tests/parent-review.test.mjs tests/review-consume.test.mjs tests/query.test.mjs`; `npm run check`; `git diff --check`; logs p2-green/check y snapshot after rollback. Result peek debe consultar política vigente; no añadir ruta que lea pending ni prometer resolver toda integración RPC inexistente.
- [ ] **5. Commit** solo Files P2: `feat: authorize scoped parent result reviews`; report y review BASE..HEAD. No P3 hasta gate.

### Task 3: P3 — Herramienta parental y retirada segura en dos fases

**Files:** Create `src/application/parent.ts`, `tests/parent-native-runtime.test.mjs`; Modify runtime/session.ts, runtime/coordinator.ts, adapters/pi/register.ts/display.ts; Modify `tests/pi-query-adapters.test.mjs`, `tests/pi-adapters.test.mjs`, `tests/coordinator.test.mjs`, `tests/session-runtime.test.mjs`. No cambio de selección CodingTools ni perfiles worker dentro del producto.

**Interfaces:**
- `ParentJobsService` con `start(request: StartRequest, resolve: ResolveInput)`, `retry(id: string, request: RetryRequest)`, `decideReview(id: string, request: ParentReviewRequest)`; retornos Outcome de P1/P2.
- `createParentJobsService(authority: ParentAuthority, start: StartService, control: ControlService, review: ReviewService): ParentJobsService`; fachada pasa la referencia exacta y exige model para start/retry. Conforme a P2 aceptada, delega el request review SIN actor; ReviewService deriva `model/parent:<sessionId>` de esa referencia. No duplicar normalización/policy ni ampliar params.
- `RuntimeOptions.sessionId?: string`, `isParentActive?: () => boolean`; `SessionRuntime.parent?: ParentJobsService`. Solo el adaptador nativo suministra sesión real y validez de generación. Sin sessionId no hay parent; los callers/test runtimes genéricos anteriores siguen válidos. Fase03 hará sessionId obligatorio por su contrato propio, no adelantar ese cambio aquí.
- `SessionRuntime.retire(): Promise<void>` inicia una sola retirada: invalidación/sellado síncrono, drenaje de writes admitidos y comienzo del cierre SDK en segundo plano; retorna al terminar esa fase 1. Callers concurrentes esperan la misma fase, sin early-return de flag.
- `SessionRuntime.close(): Promise<void>` conserva garantía de cierre COMPLETO: espera retirada, la única promesa de `Harness.close()` y liberación del lease tras éxito. Rechazo de fase 1 impide iniciar fase 2; rechazo de fase 2 observado/propagado y lease retenido. `retire()` no afirma éxito de fase 2; no reintentos automáticos.
- `Coordinator.stop()` invalida observación y bombeo; `drain()` drena submit/transacciones y el tramo post-result ya admitido (`finish`, lectura y callback que puede escribir), nunca la espera del modelo. No lanzar nueva escritura por un resultado observado después de stop. Sin cancelar la conversación/job.

- [ ] **1. Escribir tests**. Registro pasa de seis herramientas a siete, append `pi_agents_review`. Params cerrados id/status/request_id/reason, sin actor/parent/callerRole. Falta/extra/tipos/status/reason inválidos→sin escrituras. Tool→actor model parent real; native spawn→ownership; native retry con toolCallId distinto→vínculo; commands humanos siguen por jobs genérico. Runtime sin contexto no ofrece parent; worker conversation.agent(context) expone solo CodingTools seleccionadas, nunca nueva tool.

```js
assert.equal(tools.at(-1).name, 'pi_agents_review');
assert.equal(reviewActor.id, 'parent:adapter-test');
assert.equal(workerToolNames.includes('pi_agents_review'), false);
assert.equal(runtimeWithoutSession.parent, undefined);
assert.equal(lateOldSessionDecision.success, false);
```

Añadir pruebas persistentes, no solo mocks de fachada, con promesas controladas y timeout explícito10000ms, sin polling/sleeps para demostrar carreras:

- «retire termina con proveedor pendiente y close conserva lease»: arrancar proveedor faux que ignore la señal, esperar started, retirar sin liberarlo, comprobar parent invalidado y misma base `STORAGE_BUSY`; abrir otra base y ejecutar un job; liberar el proveedor, esperar `close()` real y reabrir la base original. El SDK puede esperar al modelo en `close()`, no en `retire()`.
- «retirada drena finish/markNotified ya iniciados»: bloquear una escritura después de admitida; iniciar retirada y comprobar que la fase 2 no empezó; liberar write y esperar retirada. Liberar resultado tardío después no genera otro finish/notify. Cubrir también submit/claim admitido y resolución pendiente sin nueva admisión.
- «retire/close concurrentes comparten fases»: dos llamadas a cada método no saltan drains ni duplican SDK close/release; quiet runtime conserva el contrato de close de los tests anteriores.
- «fallo SDK observado retiene lease»: provocar rechazo de cierre en fixture aislado, comprobar reporte/rechazo y `STORAGE_BUSY`, nunca success/release falso. Usar mocks existentes de Node/SDK o subprocess aislado, no añadir DI/config de producción para la prueba. Limpiar únicamente recursos temporales después de cerrar realmente el fixture.
- «sesión cambia durante createModels/openSessionRuntime»: bloquear cada await, cambiar getSessionId/generación, liberar y comprobar que el runtime obsoleto se retira sin publicación ni notificación. Nuevo ensure puede abrir la sesión vigente.
- «misma base ocupada no bloquea otra sesión ni envenena lifecycle»: un ensure recibe `STORAGE_BUSY`; luego abre otra base y, tras cierre completo, puede reintentar la original. No esperar al proveedor dentro de una cadena global de lifecycle.

En los tests de native spawn/retry/review usar servicios/runtime reales para ownership y auditoría, con toolCallId distinto en retry. Validar todos los params inválidos y snapshots sin writes; inspeccionar herramientas reales del worker, no un array mock que ya excluye review. Mantener comandos humanos y precedencia intactos.

- [ ] **2. RED:** `node --test --test-timeout=10000 tests/parent-native-runtime.test.mjs tests/coordinator.test.mjs tests/pi-adapters.test.mjs tests/session-runtime.test.mjs`; guardar `p3-fix-1-red.log` en SDD. La implementación actual carece de retire y tiene races reales: distinguir fallos de API ausente de fallos conductuales de drain/publicación. No sobrescribir p3-red.log original: su aserción/index incorrecto no fue RED funcional; corregir por append esa afirmación del reporte. Cobertura de conducta ya correcta puede comenzar GREEN honestamente, sin revert/fallo artificial.
- [ ] **3. Implementar wiring y barreras mínimas**. Conservar referencia P1 congelada, sessionId no vacío, guard dinámico y params cerrados de P3. Model spawn/retry usan parent; otros controles conservan policy/consentimiento. Implementar retire/close según Interfaces mediante promesas compartidas, sin nuevo manager/cola/dependencia. Sellar e invalidar antes del primer await, detener observación y drenar repository parental y writes coordinator; comenzar el único cierre SDK después del drenaje, observar rechazo y conservar lease hasta éxito. Los callers genéricos que esperan close mantienen su contrato.

En register, invalidar state/generación ANTES de await retire. Verificar sesión/generación tras createModels, apertura/migración y ensure; retirar todo runtime abierto obsoleto sin publicarlo. No esperar a la fase 2 para abrir otra base. Misma base ocupada devuelve `STORAGE_BUSY` por la exclusión existente, sin cola/polling; recuperar la cadena de lifecycle tras fallos para permitir otras sesiones/reintentos. Callbacks/notificaciones comprueban vigencia después de awaits y antes de markNotified; writes ya iniciados quedan incluidos en drain. Session shutdown retira, sin prometer cleanup después del fin del proceso.

En coordinator, separar la espera del modelo del tramo de writes admitido después del resultado. stop corta observación; drain espera commits/callbacks ya admitidos incluso si el resultado ganó la carrera antes de stop. Guards después de awaits en pump/submit/reconcile/finish/notificaciones impiden nuevas acciones obsoletas. No llamar conversation.abort ni simular cancelled/interrupted; no parchear SDK, saltar su cierre ni liberar lease mediante timeout/Promise.race. Si falta un API indispensable o se necesita editar fuera de Files P3, BLOCKED/NEEDS_CONTEXT con repro, no workaround inseguro.

Presentación usa formatReview con autor real/recibo; texto no llama humana a decisión parental ni la llama aceptación técnica.

- [ ] **4. GREEN:** `node --test --test-timeout=10000 tests/parent-native-runtime.test.mjs tests/coordinator.test.mjs tests/pi-query-adapters.test.mjs tests/pi-adapters.test.mjs tests/session-runtime.test.mjs`; `npm run check`; suite completa una vez; `git diff --check`. Guardar logs `p3-fix-1-green/check/test/diffcheck.log` en SDD, sin alterar evidencia histórica. Incluir pruebas de las DOS fases, fallo SDK, writer drain y native real, no solo tools.map. El probe SDK antiguo sigue mostrando close pendiente: es el límite documentado, no un test del nuevo retire.
- [ ] **5. Commit** solo Files P3: `fix: retire parent runtimes without releasing live storage`; append task-3-report.md con findings/corrección de RED/evidencia real. Re-review scoped desde `332560c` hasta el HEAD de fix, incluyendo commits documentales que modifican el contrato; cada finding original se evalúa frente a §3.1 ahora aprobada. Máximo5 rondas, primera pendiente. No aceptar P3/P4 hasta review favorable, no instalación/load ni self-approval con tool no cargada.

### Task 4: P4 — Aceptación offline, documentación y revisión de rama

**Files:** Create `tests/parent-approval-acceptance.test.mjs`, `docs/PARENT-REVIEW-ACCEPTANCE.md`; Modify `README.md`, `docs/ARCHITECTURE.md`. No Git promoción ni root .pi como parte de este commit.

**Interfaces:** consumir P3 `openSessionRuntime`, `SessionRuntime.retire()/close()` y ParentJobsService, además de P1/P2 datos existentes; no nuevo API. Aceptación offline prueba PR01–10 incluido PR09 enmendado; PR11 requiere host real, PR12 integración fase03 separada.

Deuda menor #64 de P2: antes de la revisión final, autorizar un fix separado SOLO de `tests/parent-review.test.mjs` para separar las aserciones restantes, sin cambios funcionales ni source. Registrar evidencia focal y revisión del diff; no exigir otra ronda de implementación P2 ni mezclarlo silenciosamente en Files P4.

- [ ] **1. Escribir test de flujo completo faux**: spawn propio→terminal pending→getResult bloqueado→parent.approve→getResult/consume→human.reject→parent/replayconsume denegados; reopen misma sesión conserva identity, sesión distinta rechazada, legacy sin binding requiere humano. Segunda rama failed con reporte autorizado no marca task aceptada. La tool nueva nunca aparece en workers. Reusar interfaces reales, no reemplazarlas por mocks que salten policy.
- [ ] **2. RED:** ejecutar `node --test --test-timeout=10000 tests/parent-approval-acceptance.test.mjs` antes de corrección focal si falta una conexión; si ya pasa, registrar que es acceptance GREEN y apoyarse en RED real P1–P3, no falsificar RED ni hacer revert inseguro.
- [ ] **3. Documentar** tool con ejemplo `{id, status:'approved', request_id, reason?}`, actor padre/precedencia humana/legacy/manual bootstrap/no downgrade/sin sandbox. Explicar retire vs close, lease retenido ante proveedor pendiente/fallo, misma base/reload `STORAGE_BUSY` y reintento manual, otra base operable, sin cancelación durable ni garantía de cleanup después de salir del proceso. Conservar observación «Reevaluar futuras versiones de Pi Durable»: versión1.0.1 examinada, SDK/probe relevante, pruebas con proveedor que ignora la señal, writes tardíos/lease/ausencia de cancelación, revisión independiente antes de simplificar y sin actualización automática de dependencia. Referencia a §3.1 y autorización separada. Docs de fase03 propuestas no se describen como runtime ya implementado.
- [ ] **4. Verificar** `node --test --test-timeout=10000 tests/parent-approval-acceptance.test.mjs`, `npm run check`, `npm test`, `npm pack --dry-run`, `git diff --check`; logs p4-green/check/test/package. acceptance.md separa PR01–10 offline, PR11 NOT VERIFIED, PR12 PENDING FASE03 y limitaciones. No afirmación de TUI basada en suite verde.
- [ ] **5. Commit** solo Files P4: `test: verify parent review authorization workflow`; review tarea, después reviewer distinto de rama ENTERA BASE..HEAD (incluye P1–P4, no HEAD~1). Whole-branch SPEC/QUALITY, Cannot verify/Declined y actual result autorizados antes de proponer carga.

## Gate de carga local y host — no promoción

Después de reviews reales favorables, solicitar autorización explícita para cargar el candidato local. Preservar backup/settings/compaction/perfiles; cambiar únicamente referencia de paquete revisado, reload humano. Hasta entonces, ni tooling ni aprobación se asumen disponibles. Durante bootstrap todavía pueden ser necesarias aprobaciones humanas para leer outputs de implementación/review; no es aceptación técnica de la rama.

Host PR11: (a) desde cwd ajeno cargar la extensión explícitamente con `pi -e /ruta/absoluta/al/worktree/index.ts`, evitando doble carga del paquete previo, y verificar tool presente; (b) en sesión con perfil permitido, padre despacha nuevo job, aprueba por tool y recupera resultado sin /subagents approve; worker no tiene tool; legacy/otro owner denegados; (c) humano rechaza y padre no lo restituye; (d) switch/reload conserva solo la identidad apropiada y verifica retiro, lease retenido/same-base busy, otra base operable y reapertura tras cierre real. No crear perfiles globales/credenciales sin permiso para la prueba. Reportar evidencia real y actualizar aceptación con commit documental separado. Si no hay host disponible, PR11 sigue abierto y no se declara aceptación de runtime.

El candidatoT1 ya creado `psa_1791395429528_ebfbb603bc69` carece de vínculo de esta función: conserva gate humano. No leer su report alrededor del gate, rellenar ownership ni adoptarlo por esta conversación. Continuar T1 requiere autorización válida y su scoped re-review real, no aprobación del presente plan.

## Integración posterior con fase03 — PR12

No hace falta completar fase03 para ofrecer la función nativa sobre bootstrap; PR12 no se marca cumplido con los tests anteriores. Antes de incorporar feature commits a feat/phase-03, autorización humana separada e inspección de BASE/head limpio; no cherry-pick bootstrap duplicado597ca54 ni traer código T1 rechazado a esta rama.

Actualizar explícitamente diseño/plan de fase03 §3.1 y tabla de reviewed: humano O padre propio nativo; RPC review siempre Forbidden. Mapa de tareas: T3/T4 productores mutantes agregan reviewed en mismo commit SOLO para cambio efectivo (incluye autoridad parental→humana aun con status igual); replay/no-op sin evento; T5 conserva parentSessionId/decidedByActor y ledger/sourceHash/backup completos4→5; T7 conserva sellado/drenaje; T8/T9 niegan RPCreview y proyecciones no muestran ownership/actores. Añadir tests a los archivos de cada tarea cuando existan realmente; este plan no inventa servidor/emisor/fixtures ausentes. Registrar carries en sus briefs y revisar conflictos semánticos, no resolverlos mecánicamente.

Gate PR12: después de T3–T9 implementadas y aceptadas, covering tests prueban decisión parental→review/ledger/outbox, rollback, no evento replay/no-op, human mismo status como cambio de autoridad, RPCreviewForbidden, proyecciónprivada y migración conserva metadata. Suite/types/syntax/package completos, revisión rango integrado y TUI según fase03. No main/push/merge automático.

## Self-review y handoff

Cobertura PR01/03/07/10→P1, PR02/04/06/08→P2, PR05/09→P3, PR01–10 integradas→P4; PR11→gate host y PR12→integración explícitamente pendiente. Los cinco Review Focus tienen tests nombrados en sus propietarios. API genérica sigue humano/actor original, facade nativa no exige añadir credenciales a params; tokens por referencia interna, ownership durable, aliases/types/métodos iguales entre tareas.

Plan completo no es implementación ni aceptación. Revisión humana del plan antes de crear perfiles/ejecutar; método subagentes conservado salvo petición explícita de otro. Después cargar solo candidato revisado y observar gates pendientes de legacy/host/fase03.
