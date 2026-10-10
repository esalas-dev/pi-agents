# Implementation Plan: Preparación arquitectónica

**Branch**: `000-preparacion-arquitectonica` (identificador; sin nueva rama Git) | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Conversión del plan existente, no planificación nueva ni ejecución.

**Status**: completada según el roadmap; aceptación documental contradictoria. Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

**Uso histórico; NO EJECUTAR como backlog nuevo.** El roadmap da por completada la fase. Las casillas
se importan sin reinterpretar: una casilla vacía no acredita trabajo pendiente ni autoriza repetirlo.
Antes de reusar este plan se requiere reconciliarlo con la evidencia y una solicitud humana nueva.

## Summary

Rediseñar la base de `pi-agents` conservando sus entradas públicas, con almacenamiento separado, migración humana, inicio idempotente y recuperación verificable.

Separar adaptadores Pi, aplicación, dominio, infraestructura Durable y runtime por sesión. Mantener un SQLite por sesión y actualizar documentos relacionados en un único commit Durable. Construir y probar componentes antes de sustituir el coordinador actual; no conservar `JobManager` como fachada definitiva.

## Technical Context

**Language/Version**: TypeScript estricto; Node según el entorno original indicado abajo.

**Primary Dependencies**: macOS arm64; Node 26.10.0; Pi 1.0.4; Pi Durable 1.0.1; Chord 1.0.1; YAML 2.9.0; TypeScript 5.9.3; @types/node 26.6.4; node:test y node:sqlite.

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

Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.
Antes de investigar o cambiar diseño se reevalúan dependencias del roadmap; antes de implementar,
se verifica spec, plan, método y alcance humano. Los controles no aplicables se justifican; no se
saltan fallos conocidos ni se afirma compatibilidad no probada.

## Project Structure

### Documentation (this feature)

```text
specs/000-preparacion-arquitectonica/
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

- «Un SQLite por sesión, con documentos separados y transacciones comunes.»
- «Migración explícita por base, autorizada por humano y precedida por backup consistente.»
- «Compatibilidad inicial limitada al entorno inspeccionado, no a todos los mínimos históricos.»
- «Actores atribuidos por adaptadores; ningún argumento de tool concede identidad humana.»
- «Deduplicación del inicio por identidad de solicitud, sin añadir parámetros a la tool existente.»
- «El ledger no guarda cuerpos de resultados ni se purga automáticamente.»
- «No se añaden a `dependencies` ni se empaquetan copias directas»: aplica a paquetes suministrados por Pi; inventariar las dependencias transitivas de Durable.
- «El nuevo mínimo Node será `26.10.0`, sin equiparar ese rango a una matriz probada.»
- «No hay migración por lotes en esta fase.» No usar SQL propio para mutar tablas internas de Durable.
- Conservar `/subagents <agente> <tarea>`, `status`, `result` y `pi_agents({ agent, task })`; añadir únicamente `/subagents-storage migrate`.
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

Plan aprobado; ejecución nativa elegida por el usuario. Las casillas se actualizarán solo con evidencia. El baseline de código es `efc690f`; `c6fc78b` añade el diseño. La implementación empieza solo tras revisión del plan y elección de ejecución. Crear aislamiento en ese momento siguiendo aislamiento mediante worktree Git autorizado, no durante esta planificación.

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

## Secuencia de entregas

- Bloque 1: Congelar v1 y caracterizar el contrato existente; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 2: Type-check real y grafo de módulos comprobable; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 3: Contratos de dominio, errores y canonización; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 4: Documentos separados y repositorio transaccional; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 5: Admisión idempotente y servicios de consulta actuales; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 6: Propiedad, inspección segura y backup SQLite; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 7: Conversión v1 autorizada y atómica; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 8: Ejecución Durable y coordinador recuperable; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 9: Runtime por sesión y ownership de recursos; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 10: Adaptadores Pi, mantenimiento TUI y sustitución del monolito; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 11: Caídas reales, aceptación y documentación de operación; detalle ejecutable en [tasks.md](tasks.md).

Todos los pasos, scopes, pruebas y comandos pasan a [tasks.md](tasks.md), con las mismas casillas.

## Antecedentes de revisión y handoff

Las notas siguientes se conservan como contexto del plan original. En fases cerradas no reabren
trabajo ni reemplazan el estado del encabezado; en trabajo abierto conservan sus condiciones.

### Cobertura de spec y criterios

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

### Autorrevisión y handoff

El plan cubre la conversión estructural en fase 00; revisión/consumo siguen en fase 01. Las tareas posteriores reutilizan los contratos definidos aquí; cualquier cambio de firma debe actualizar consumidores, pruebas y este plan antes de delegar otra tarea.

Decisiones de tooling verificadas durante planificación: npm publica TypeScript `5.9.3` y `@types/node 26.6.4`; Pi `1.0.4` expone `ctx.mode`, y `hasUI` también puede ser true en RPC. Estas inspecciones no acreditan el type-check nuevo ni la migración.

**Recomendación de ejecución:** nativa por el acoplamiento de documentos, repositorio, migración y runtime; conservar gates por tarea. No se encontró una herramienta de subagentes disponible al planificar. La alternativa subagent-driven requiere habilitarla primero; no se simularán implementadores/revisores independientes en el mismo contexto.

Revisar el documento y elegir método antes de ejecutar cualquier tarea. La aprobación de la spec no aprueba este plan automáticamente.

## Procedencia

[Plan original completo](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-06-fase-00-preparacion-arquitectonica.md).
[Matriz de migración y discrepancias](../MIGRATION.md). No se ejecutaron tareas de este plan.
