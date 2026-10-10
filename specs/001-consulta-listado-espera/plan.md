# Implementation Plan: Consulta, listado y espera

**Branch**: `001-consulta-listado-espera` (identificador; sin nueva rama Git) | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Conversión del plan existente, no planificación nueva ni ejecución.

**Status**: completada según roadmap e informe de aceptación. Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

**Uso histórico; NO EJECUTAR como backlog nuevo.** El roadmap da por completada la fase. Las casillas
se importan sin reinterpretar: una casilla vacía no acredita trabajo pendiente ni autoriza repetirlo.
Antes de reusar este plan se requiere reconciliarlo con la evidencia y una solicitud humana nueva.

## Summary

Añadir consulta, listado paginado, espera cancelable, revisión humana y consumo idempotente sobre el esquema Durable 2, mediante una migración explícita al esquema 3.

La aplicación expondrá servicios de lectura y decisión sobre el repositorio de fase 00; los adaptadores Pi solo traducirán comandos/tools, actores y presentación. `JobsIndexDoc` seguirá siendo una proyección compacta para filtros y cursores; revisión, consumo y cuerpos de resultado permanecerán en documentos separados. La espera usará `watchDoc` con el patrón snapshot → suscripción → snapshot y nunca modificará el job.

## Technical Context

**Language/Version**: TypeScript estricto; Node según el entorno original indicado abajo.

**Primary Dependencies**: TypeScript estricto, Node.js 26.10.0, `@earendil-works/pi-durable` 1.0.1, Chord, SQLite público `node:sqlite`, Pi 1.0.4, Node test runner y fixtures Durable en SQLite.

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
specs/001-consulta-listado-espera/
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

- Compatibilidad objetivo: macOS arm64, Node `26.10.0`, Pi `1.0.4` y Pi Durable `1.0.1`.
- No instalar dependencias ni modificar declaraciones del host; usar únicamente APIs públicas y bindings inyectables en pruebas.
- Mantener un SQLite por sesión; no abrir SQLite de otras sesiones simultáneamente.
- La fase no implementa cancelación, pausa, retry, RPC, streaming, gates, grupos, worktrees, steering, cron, workflows ni promoción.
- Las tools no pueden aprobar/rechazar resultados ni devolver cuerpos `pending` o `rejected`.
- El límite textual de una tool es `64 KiB`; el cuerpo completo permanece en `JobResultDocFamily`.
- El cursor de listado es opaco y representa `(createdAt,id)` descendente; no depende de `JobsIndexDoc.order`.
- `consume` exige `requestId` para deduplicación fuerte; el ledger es la autoridad, no la ventana histórica del documento de consumo.
- Migrar esquema 2→3 requiere autorización humana TUI, backup consistente y bloqueo del runtime mientras la base no esté convertida.
- El resultado humano usa `peek` por defecto; aprobar no ejecuta comandos, fusiona ramas ni promueve artefactos.
- Todos los documentos de revisión, consumo y ledger se actualizan atómicamente con las mutaciones que representan.

## Review Focus

- **Race snapshot/watch:** un job que termina entre la primera lectura y la suscripción debe satisfacer `wait` sin perder la transición; lo fija Task 3.
- **Cursor con timestamps repetidos:** jobs con el mismo `createdAt` deben paginar sin duplicar ni omitir IDs; lo fija Task 2.
- **Replay de consume:** mismo `requestId` debe devolver el recibo original sin incrementar el contador; lo fija Task 4.
- **Filtrado de resultados sensibles:** tools no deben filtrar cuerpos `pending`/`rejected` ni superar 64 KiB; lo fija Task 8.
- **Runtime en esquema antiguo:** una base 2 no debe abrir el Harness ni llamar al proveedor antes de una migración TUI autorizada; lo fija Task 5 y Task 9.

---

## Mapa de archivos

- `src/domain/jobs.ts`, `src/domain/errors.ts`, `src/domain/requests.ts`: tipos de vistas, filtros, espera, revisión, consumo y errores públicos.
- `src/infrastructure/durable/documents.ts`: documentos de revisión/consumo y esquema 3.
- `src/infrastructure/durable/repository.ts`: lectura compacta, cursores, ledger tipado y commits de consumo/revisión.
- `src/infrastructure/storage/inspect.ts`, `migrate.ts`, `src/application/maintenance.ts`: inspección y migración 2→3.
- `src/application/query.ts`, `review.ts`, `result.ts`: casos de uso independientes del host Pi.
- `src/adapters/pi/display.ts`, `resolve.ts`, `register.ts`, `src/command.ts`: comandos, tools, renderizado, truncado y autoridades de actor.
- `tests/fixtures/v2/`, `tests/helpers/`, `tests/query.test.mjs`, `tests/wait.test.mjs`, `tests/review-consume.test.mjs`, `tests/migration-v2.test.mjs`, `tests/pi-query-adapters.test.mjs`: fixtures y pruebas de aceptación.
- `README.md`, `docs/ARCHITECTURE.md`, `specs/ROADMAP.md`: documentación de la interfaz y estado de fase.

---

## Secuencia de entregas

- Bloque 1: Extender contratos y documentos al esquema 3; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 2: Implementar vistas, filtros y paginación estable; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 3: Implementar espera durable y cancelable; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 4: Implementar resultado, revisión y consumo idempotente; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 5: Migrar esquema 2 a esquema 3; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 6: Ampliar parser y presentación de comandos; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 7: Registrar servicios de consulta en Pi; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 8: Integrar lifecycle y bloqueo de esquema; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 9: Actualizar documentación y pruebas de aceptación; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 10: Gate final de fase 01; detalle ejecutable en [tasks.md](tasks.md).

Todos los pasos, scopes, pruebas y comandos pasan a [tasks.md](tasks.md), con las mismas casillas.

## Antecedentes de revisión y handoff

Las notas siguientes se conservan como contexto del plan original. En fases cerradas no reabren
trabajo ni reemplazan el estado del encabezado; en trabajo abierto conservan sus condiciones.

### Plan self-review

- **Cobertura de spec:** RF-01/02 → Tasks 1–2; RF-03 → Task 3; RF-04/05 → Task 4; RF-06 → Task 6/7; migración → Task 5/8; comandos/tools → Task 6/7; recuperación/documentación → Tasks 8–10.
- **Consistencia de tipos:** `JobFilter`, `JobQueryView`, `WaitOptions`, `ResultAccess`, `ReviewDecision` nacen en Task 1 y son consumidos con los mismos nombres en Tasks 2–8.
- **Carreras:** snapshot/watch, timestamps repetidos y replay de ledger tienen pruebas propietarias explícitas.
- **Seguridad:** autorización TUI, filtrado de revisión y límite de salida se prueban antes de conectar el registro real.
- **Dependencias:** la migración precede la apertura schema 3; ningún task de adaptadores crea transiciones ni acceso SQL interno.
- **Limitación declarada:** no se promete aceptación de fase hasta ejecutar el gate final y obtener revisión/aceptación humana separada.

## Procedencia

[Plan original completo](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-06-fase-01-consulta-listado-espera.md).
[Matriz de migración y discrepancias](../MIGRATION.md). No se ejecutaron tareas de este plan.
