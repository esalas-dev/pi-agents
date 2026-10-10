# Implementation Plan: Widget de subagentes A+B

**Branch**: `011-widget-subagentes` (identificador; sin nueva rama Git) | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Conversión del plan existente, no planificación nueva ni ejecución.

**Status**: spec y plan aprobados; ejecución Native; aceptación A/B pendiente según fuentes. Excepción humana A+B aprobada el 2026-10-08, método Native. A requiere aceptación antes de B; no habilita la fase 10 completa.

**No ejecutar por la migración.** Se conservan el estado de autorización y los gates originales;
la aprobación de la spec no aprueba el plan ni autoriza commits, publicación o migraciones reales.

## Summary

Mostrar automáticamente sobre el editor de Pi un widget compacto con estado durable, duración y spinner (A), y después actividad técnica allowlisted observada desde LiveDoc (B).

El adaptador Pi conserva la autoridad del runtime y monta/retira una proyección de UI solo en TUI. A consulta los servicios existentes; B añade en `SessionRuntime` una frontera estrecha que resuelve job→conversación y devuelve únicamente actividad proyectada. El componente no accede a SQLite, Harness, transcript ni contenido de mensajes.

## Technical Context

**Language/Version**: TypeScript estricto; Node según el entorno original indicado abajo.

**Primary Dependencies**: TypeScript del paquete, APIs públicas de Pi 1.1.0 y Pi Durable 1.0.1; pruebas Node `node:test`, reloj/timers controlados y Harness SQLite real para B. Sin dependencias nuevas.

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

Excepción humana A+B aprobada el 2026-10-08, método Native. A requiere aceptación antes de B; no habilita la fase 10 completa.
Antes de investigar o cambiar diseño se reevalúan dependencias del roadmap; antes de implementar,
se verifica spec, plan, método y alcance humano. Los controles no aplicables se justifican; no se
saltan fallos conocidos ni se afirma compatibilidad no probada.

## Project Structure

### Documentation (this feature)

```text
specs/011-widget-subagentes/
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

## Restricciones globales

- Solo la excepción A+B está autorizada; el panel y la fase 10 completa siguen bloqueados por 01–09.
- Registrar el widget únicamente cuando `ctx.mode === "tui" && ctx.hasUI`; RPC con UI, print y JSON no crean widget ni timers.
- Usar `ctx.ui.setWidget("pi-durable-subagents", factory, { placement: "aboveEditor" })`; retirar con `setWidget(key, undefined)` tras consulta exitosa vacía.
- Seleccionar `running`/`cancelling` y luego `queued`/`paused`, límite 5 por consulta, máximo 4 filas, máximo 6 líneas; refrescar 1000 ms después de completar la consulta anterior. Mostrar estados públicos sin alterar su significado (`provisioning` como `running`), usar duración solo desde `startedAt` y no inventar posición de cola.
- Un fallo no aplica selección parcial: conservar última vista y marcarla desactualizada; consulta lenta >5 s tampoco se solapa.
- Spinner `|`, `/`, `-`, `\\` cada 250 ms con un único reloj de animación; ticks no consultan ni llaman modelos. `PI_AGENTS_ANIMATION=0` desactiva solo movimiento.
- El render respeta ancho/tema con utilidades públicas `visibleWidth()` y `truncateToWidth()`; sanitiza CSI/OSC y controles antes de presentar datos.
- En B, observar como máximo 4 jobs activos y usar `harness.watchDoc(LiveDoc, conversationId, context)`; proyectar solo nombres/identidad de tools activas, intento/espera y compactación. No mostrar ni retener texto, prompts, args, output, diagnostics o errores libres.
- Cleanup idempotente en cambio/reapertura/cierre; no aborta conversaciones ni cambia estados, resultados, aprobaciones o notificaciones.
- No cambiar manifest, dependencias, storage, schema, outbox, RPC ni semántica de jobs.
- El host instalado comprobado es Pi 1.1.0; no afirmar compatibilidad con Pi objetivo 1.0.4 ni aceptación TUI hasta comprobarlos separadamente.
- Baseline local: `npm test` da 98/99 porque `tests/host-resolution.test.mjs` exige 1.0.4 y el host instalado es 1.1.0; el usuario autorizó continuar. `npm run check` pasa en Pi 1.1.0. No modificar ni ocultar esa prueba; mientras la suite completa permanezca roja, no marcar tareas de implementación como completadas.

## Review Focus

1. **Consulta que falla tras una selección no vacía:** conservar filas previas y etiquetar frescura; nunca retirar el widget por error.
2. **Éxito vacío frente a consulta fallida:** solo el resultado exitoso vacío retira el widget; una consulta posterior puede montarlo de nuevo.
3. **TUI/RPC/print:** `hasUI: true` en RPC no basta para montar ni iniciar timers.
4. **Carrera entre sesiones/cierre:** respuestas, adquisiciones y callbacks tardíos no remontan filas ni invalidan componentes retirados.
5. **Contenido sensible de LiveDoc y terminal:** valores centinela de generación/tool no alcanzan el modelo de vista, render, logs ni secuencias ANSI.

---

## Secuencia de entregas

- Bloque 1: Etapa A — consulta, visibilidad y widget compacto; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 2: Etapa B — frontera de observación Durable; detalle ejecutable en [tasks.md](tasks.md).
- Bloque 3: Etapa B — actividad en widget y degradación segura; detalle ejecutable en [tasks.md](tasks.md).

Todos los pasos, scopes, pruebas y comandos pasan a [tasks.md](tasks.md), con las mismas casillas.

## Antecedentes de revisión y handoff

Las notas siguientes se conservan como contexto del plan original. En fases cerradas no reabren
trabajo ni reemplazan el estado del encabezado; en trabajo abierto conservan sus condiciones.

### Handoff y estado

Spec y plan aprobados humanamente el 2026-10-08; método elegido: Native. El smoke de APIs no equivale a aceptación TUI ni a soporte Pi 1.0.4. La tarea 1 empieza en worktree aislado; no iniciar B hasta la aceptación TUI humana de A.

## Procedencia

[Plan original completo](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-08-widget-subagentes.md).
[Matriz de migración y discrepancias](../MIGRATION.md). No se ejecutaron tareas de este plan.
