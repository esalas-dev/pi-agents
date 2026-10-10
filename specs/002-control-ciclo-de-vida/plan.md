# Implementation Plan: Control durable del ciclo de vida

**Branch**: `002-control-ciclo-de-vida` (identificador; sin nueva rama Git) | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Conversión del plan existente, no planificación nueva ni ejecución.

**Status**: completada según roadmap e informe de aceptación. Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

**Uso histórico; NO EJECUTAR como backlog nuevo.** El roadmap da por completada la fase. Las casillas
se importan sin reinterpretar: una casilla vacía no acredita trabajo pendiente ni autoriza repetirlo.
Antes de reusar este plan se requiere reconciliarlo con la evidencia y una solicitud humana nueva.

## Summary

Añadir cancelación cooperativa, pausa/reanudación de jobs en cola, retry enlazado e historial durable sin fingir pausa activa cuando Pi Durable no la soporta.

Un `ControlService` será la única autoridad de mutaciones de ciclo de vida para comandos, tools y RPC futuro. Las intenciones se persistirán con el ledger antes de cualquier efecto Durable; el coordinador reconciliará cancelaciones activas mediante `Conversation.abort()`, `Submission.abort()` o `Harness.abortTask()` públicos. La fase introduce esquema 4 con migración explícita desde esquema 3 para conservar compatibilidad, control e historial.

## Technical Context

**Language/Version**: TypeScript estricto; Node según el entorno original indicado abajo.

**Primary Dependencies**: TypeScript estricto, Node.js 26.10.0, `@earendil-works/pi-durable` 1.0.1, Chord, SQLite público `node:sqlite`, Pi 1.0.4 y Node test runner.

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
specs/002-control-ciclo-de-vida/
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

## Secuencia de entregas

- Bloque 1: Extender contratos y documentos al control durable; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 2: Implementar mutaciones atómicas de cola y control; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 3: Implementar retry enlazado e idempotente; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 4: Añadir aborto público y reconciliación del coordinador; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 5: Migrar esquema 3 a esquema 4 y componer runtime; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 6: Exponer comandos, tool y autoridad TUI; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 7: Actualizar documentación y matriz de aceptación; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 8: Ejecutar gates y aceptación de fase 02; detalle ejecutable en [tasks.md](tasks.md).

Todos los pasos, scopes, pruebas y comandos pasan a [tasks.md](tasks.md), con las mismas casillas.

## Antecedentes de revisión y handoff

Las notas siguientes se conservan como contexto del plan original. En fases cerradas no reabren
trabajo ni reemplazan el estado del encabezado; en trabajo abierto conservan sus condiciones.

### Plan self-review

- **Cobertura de spec:** RF-01 → Tasks 1–2/6; RF-02 → Task 2; RF-03 → Task 2/6; RF-04 → Task 4; RF-05 → Task 2; RF-06 → Task 3; RF-07 → Task 2; interfaces → Task 6; migración/reapertura → Task 5; pruebas y documentación → Tasks 7–8.
- **Consistencia de tipos:** `ControlRequest`, `ControlReceipt`, `RetryRequest` y `RetryReceipt` nacen en Task 1; repository, service, coordinator y adapters los consumen sin redefinirlos.
- **Autoridad:** la tool usa actor model y queda limitada por política; comandos y migración usan actor human/TUI; no existe `force kill`.
- **Carreras:** pause/cancel, retry/retry, cancelación antes de `submissionId` y replay de ledger tienen pruebas propietarias.
- **Reconciliación:** cada ventana de caída tiene una prueba en Task 4 o Task 5; `requestId` evita repetir efectos externos.
- **Limitación declarada:** la pausa activa no se implementa hasta que exista una API pública; el plan la prueba como error explícito.
- **Proporción:** ocho tareas separan contratos, persistencia, ejecución, migración, adaptadores y gates; cada una termina con prueba y commit independiente.

## Procedencia

[Plan original completo](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-07-fase-02-control-ciclo-vida.md).
[Matriz de migración y discrepancias](../MIGRATION.md). No se ejecutaron tareas de este plan.
