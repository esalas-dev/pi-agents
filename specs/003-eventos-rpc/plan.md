# Implementation Plan: Eventos y RPC versionado

**Branch**: `003-eventos-rpc` (identificador; sin nueva rama Git) | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Conversión del plan existente, no planificación nueva ni ejecución.

**Status**: plan aprobado y ejecutado históricamente con método subagent-driven; implementación fusionada en la base `94288cc`, fase completada y promocionada administrativamente con límites por decisión humana. No reejecutar tareas. Revisión independiente inicial NO APTO; N1–N5 revalidados y corregidos localmente, N6 cubierta por fixture v4 válida de recuperación/replay; veredicto favorable posterior aceptado humanamente, informe independiente no recuperable; aceptación TUI recibida para todos los bloques guiados en el candidato faux local temporal, sin proveedor remoto ni migración real.

**No ejecutar por la migración.** Se conservan el estado de autorización y los gates originales;
la aprobación de la spec no aprueba el plan ni autoriza commits, publicación o migraciones reales.

## Summary

Exponer RPC v1 a extensiones locales de confianza y emitir eventos persistidos atómicamente con las transiciones de jobs.

Adaptador fino sobre `pi.events` y `JobsService`, ledger existente y outbox transaccional por sesión. Un propietario de lifecycle controla generaciones, endpoints, esperas y un emisor ordenado; SQLite mantiene la autoridad. Las tareas son secuenciales porque almacenamiento, control y transporte comparten estas interfaces.

## Technical Context

**Language/Version**: TypeScript estricto; Node según el entorno original indicado abajo.

**Primary Dependencies**: TypeScript estricto, Node `26.10.0`, Pi `1.0.4`, Pi Durable `1.0.1`, SQLite y `node:test`; sin dependencias nuevas.

**Storage**: SQLite por sesión principal y documentos Pi Durable; versiones y conversiones según spec.

**Testing**: `node:test`, fixtures y Harness/SQLite real donde lo exige el plan; no se ejecutan aquí.

**Target Platform**: Entorno macOS observado en las fuentes; host objetivo y host probado no se equiparan.

**Project Type**: Paquete de extensión Pi, no aplicación de fábrica ni daemon externo.

**Performance Goals**: Preservar los límites medibles del contrato; no se introduce un objetivo nuevo
de throughput ni se anuncian mediciones no ejecutadas.

**Constraints**: APIs públicas, autoridad separada, proyecciones acotadas y recuperación durable.

**Scale/Scope**: Alcance de esta spec y de los bloques importados; no habilita fases posteriores.

## Constitution Check

Evaluación documental frente a [constitución](../../.specify/memory/constitution.md).
La ratificación sigue pendiente. Los gates de ejecución no se consideran verdes por esta evaluación.

| Principio | Control del diseño | Gate de ejecución |
| --- | --- | --- |
| I. Durable | Documentos autoritativos y proyecciones separados en spec y detalle técnico | Atomicidad/cierre/reapertura aplicables |
| II. Idempotencia | requestId y reconciliación en los contratos importados; UI de widget no muta | Duplicados, conflictos y ventanas de caída |
| III. Autoridad | Procedencia humana, sin promoción automática; widget solo observa | Revisiones y consentimientos aplicables |
| IV. Seguridad | Datos sensibles y límites de exposición preservados | Inputs hostiles, allowlists y contenido centinela |
| V. Contratos | Servicios comunes y APIs públicas; no se agregan dependencias | Type-check, integración y degradaciones explícitas |

Diseño/plan aprobados y método subagent-driven registrados; fase implementada en validación.
No reejecutar tareas históricas. Los gates de cierre se retoman después de 011.
Antes de investigar o cambiar diseño se reevalúan dependencias del roadmap; antes de implementar,
se verifica spec, plan, método y alcance humano. Los controles no aplicables se justifican; no se
saltan fallos conocidos ni se afirma compatibilidad no probada.

## Project Structure

### Documentation (this feature)

```text
specs/003-eventos-rpc/
├── spec.md
├── plan.md
└── tasks.md
```

Los documentos originales se archivan en `specs/_archive/pre-specify-2026-10-09/`. Evidencia de aceptación y guía runtime
permanecen en `docs/`; no se inventan research.md, data-model.md, quickstart.md ni contratos
independientes donde no existían. El detalle de esos contratos se conserva en spec/plan/tasks.

### Source Code (repository root)

La estructura sigue siendo `index.ts`, `src/`, `scripts/` y `tests/`. Las rutas por bloque
identifican alcance histórico o propuesto, no garantizan que todos esos archivos existan hoy.

**Structure Decision**: Conservar capas de adaptadores, aplicación, dominio, infraestructura y
runtime del paquete; solo cambia la organización documental.

## Complexity Tracking

No se añaden capas, dependencias ni opciones de runtime. La migración no constituye auditoría
retrospectiva de implementación; una nueva desviación requiere necesidad y alternativa más simple.

## Detalle técnico del plan preservado

## Global Constraints

- Entorno objetivo: macOS arm64, Node `26.10.0`, Pi `1.0.4`, Pi Durable `1.0.1`; no prometer compatibilidad histórica ni universal posterior.
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

## Preparación para la ejecución (no realizada)

Los cuatro pasos previos se conservan en [tasks.md](tasks.md), Phase 1; no se ejecutaron.

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

## Secuencia de entregas

- Bloque 1: Contratos y proyecciones públicas (AC-01,02,07,13); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 2: Almacenamiento transaccional del outbox (AC-04,06); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 3: Eventos en cada commit observable (AC-03,04,13); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 4: Autoridad transaccional y replay de resultados (AC-08,09,10); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 5: Esquema 5 y migración humana 4→5 (AC-14); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 6: Emisor ordenado con confirmación posterior (AC-05,06,13); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 7: Lifecycle compartido y cierre por generación (AC-01,11,12); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 8: Servidor RPC sobre servicios y consentimiento real (AC-01,02,03,07–13); detalle ejecutable en [tasks.md](tasks.md).
- Bloque 9: Cliente público, integración caller y gates de aceptación (AC-15–17); detalle ejecutable en [tasks.md](tasks.md).

Todos los pasos, scopes, pruebas y comandos pasan a [tasks.md](tasks.md), con las mismas casillas.

## Antecedentes de revisión y handoff

Las notas siguientes se conservan como contexto del plan original. En fases cerradas no reabren
trabajo ni reemplazan el estado del encabezado; en trabajo abierto conservan sus condiciones.

### Cobertura y revisión del plan

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

### Handoff humano original (superado)

La [fuente posterior de `94288cc`](../_archive/origin-main-94288cc/docs/superpowers/plans/2026-10-07-fase-03-eventos-rpc.md)
registra aprobación humana del plan y método subagent-driven. El texto siguiente
es el handoff anterior, no un bloqueo vigente ni autorización de ejecución nueva.


Revisar este plan y confirmar que captura lo deseado antes de ejecutar. Elegir:

- **Subagent-driven (recomendado):** implementador y reviewer nuevos por tarea, más revisión completa final; más coste/contextos, gates independientes tempranos para atomicidad, autoridad y lifecycle.
- **Native:** implementación en esta sesión con gates por tarea y una revisión independiente final; menor coste, sin revisión independiente intermedia.

En el handoff original no había método elegido. La fuente posterior registra
subagent-driven para la ejecución ya realizada; la recomendación histórica no autoriza
nuevo despacho ni reimplementación. Si los agentes disponibles no pueden usar una rama/worktree autorizados o entregar revisión obtenible humanamente, explicar la limitación antes de elegir o cambiar método.

## Procedencia

[Plan original completo](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-07-fase-03-eventos-rpc.md).
[Matriz de migración y discrepancias](../MIGRATION.md). No se ejecutaron tareas de este plan.
