# Tasks: Widget de subagentes A+B

**Input**: [spec.md](spec.md) y [plan.md](plan.md).

**Prerequisites**: Spec/plan aprobados, método Native; excepción humana del 2026-10-09 permitió B antes de A y decisión conjunta. A+B implementadas en `94288cc`; continuar solo con cierre y correcciones acotadas, sin habilitar fase 10.

**Estado del registro conciliado**: 16 pasos, 14 casillas históricas en la fuente posterior
[archivada de `94288cc`](../_archive/origin-main-94288cc/docs/superpowers/plans/2026-10-08-widget-subagentes.md).
La importación inicial tenía 3 y se conserva intacta en el archivo pre-specify.
T005/T015 se cierran ahora por confirmación humana del 2026-10-09: todos los escenarios
GUIADOS del candidato local faux pasaron, con límites en [aceptación](../../docs/WIDGET-ACCEPTANCE.md).
Total vigente: 16/16. Las otras casillas no son reruns de TDD ni observación de cada
escenario TUI. No reejecutar los bloques implementados; no autoriza publicación.
**No ejecutar por la migración.** Se conservan el estado de autorización y los gates originales;
la aprobación de la spec no aprueba el plan ni autoriza commits, publicación o migraciones reales.

**Tests**: Se preservan pruebas, comandos, expected failures y gates; no son resultados obtenidos
ahora. Nuevos cambios requieren los controles de la constitución.

**Organization**: Cada paso tiene ID Tnnn. Los US apuntan a escenarios de spec.md. Los nombres T1,
T2… del detalle técnico original identifican bloques, no los nuevos IDs de pasos T001, T002…

## Phase 1: Preparación y autoridad

No se añaden pasos previos nuevos. Aplican la aprobación, dependencias y gates del plan.

## Phase 2: User Story 1 - Observar estado y duración junto al editor (A) (Priority: P1)

### Bloque 1: Etapa A — consulta, visibilidad y widget compacto

**Archivos:**
- Crear `src/adapters/pi/subagents-widget.ts`: controlador, selección, render y lifecycle del componente.
- Modificar `src/adapters/pi/register.ts`: iniciar el controlador tras abrir runtime en TUI y detenerlo antes de cerrar/cambiar runtime.
- Crear `tests/pi-subagentes-widget.test.mjs`: reloj y servicios controlados para controlador/render.
- Modificar `tests/pi-adapters.test.mjs`: registro y lifecycle por modo.
- Modificar `README.md` y `docs/ARCHITECTURE.md` solo cuando A pase aceptación; describir A sin afirmar B.

**Interfaces:**
- Consume: `JobsService.listJobs(filter)` y `ExtensionContext.ui.setWidget()` ya existentes; `JobListView`, `publicStatus()` y utilidades públicas de `@earendil-works/pi-tui`.
- Produce: `createSubagentsWidget(options): { start(): void; close(): Promise<void> }`, interno al adaptador. `options` recibe `jobs: Pick<JobsService, "listJobs">`, `ui: Pick<ExtensionContext["ui"], "setWidget">` y reloj/timers reemplazables en pruebas. El controlador posee consulta y timers; la fábrica crea el componente cuando Pi monta el widget.

- [x] T001 [US1] Escribir pruebas fallidas para estados, visibilidad y lifecycle — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md`

Añadir `selecciona activos antes que cola, limita cuatro filas y señala continuacion`, `solo retira el widget tras consulta exitosa vacia`, `fallo conserva seleccion previa marcada desactualizada`, `consulta lenta no se solapa y expira frescura`, `duracion usa startedAt y no inventa cola`, `render en anchos 20 40 80 conserva estado tema y Unicode`, `sanitiza CSI OSC y controles`, `stop cancela timers y rechaza callbacks tardios incluso tras reabrir el mismo sessionId`, `rpc con hasUI no monta widget` y `widget no muta jobs ni consume resultados`. Afirmar filtros exactos, montaje/retirada, 250 ms y secuencia `| / - \\`, movimiento reducido, queued/paused y datos desactualizados estáticos, ausencia de cursor-following y ausencia de datos centinela de tarea/cwd/resultados.

- [x] T002 [US1] Ejecutar las pruebas para confirmar el fallo — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md`

Ejecutar: `node --test tests/pi-subagentes-widget.test.mjs`
Esperado: falla porque el controlador/widget aún no existe.

- [x] T003 [US1] Implementar controlador y render de A — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md`

Crear `createSubagentsWidget` en `src/adapters/pi/subagents-widget.ts`; mantener modelo de vista acotado, dos consultas por conjunto, refresco serial y timer solo tras resolver la lectura previa. Integrar en `register.ts` con guardia TUI exacta y cleanup antes del runtime.

- [x] T004 [US1] Ejecutar gates automatizados de A — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md`

Ejecutar `node --test tests/pi-subagentes-widget.test.mjs tests/pi-adapters.test.mjs`, `npm run check`, `npm test` y el smoke de carga documentado en README: `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`.
Esperado vigente: pruebas de A, check y suite completa pasan. El baseline 98/99 y luego
109/110 por Pi 1.0.4 eran históricos; la base fusionada descubre/alinea los peers del host.
No ocultar fallos ni afirmar compatibilidad adicional. No marcar tareas completas con gates rojos.

- [x] T005 [US1] Aceptación manual de A y pausa de revisión — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md`

En Pi TUI instalado 1.1.0 desde cwd no relacionado: comprobar jobs activos/cola, retirar al vaciar tras lectura exitosa, mantener editor/foco y cambiar/reabrir sesión. Registrar host/versiones y resultado; no afirmar 1.0.4. La condición de iniciar B solo
tras aceptar A fue sustituida por autorización humana de aceptación conjunta. Esta casilla
se cierra por la declaración TUI del candidato del 2026-10-09, no por reimplementar B.

- [x] T006 [US1] Diferir documentación de aceptación hasta A+B — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md`

Fuente posterior: documentación/aceptación de A se difirieron a A+B por decisión humana;
no se afirma aceptación separada de A. Revisar diff, APIs públicas, consultas sin cuerpos,
modos y limpieza; la documentación conjunta vive en T016.

## Phase 3: User Story 2 - Observar actividad técnica allowlisted (B) (Priority: P2)

B está implementada bajo la excepción humana de aceptación conjunta. Los pasos siguientes
son históricos; no adelantan la interfaz operativa completa.

### Bloque 2: Etapa B — frontera de observación Durable

**Archivos:**
- Modificar `src/runtime/session.ts`: exponer `watchJobActivity(jobId, onUpdate)` sin exponer Harness ni conversationId.
- Crear `tests/session-widget-observation.test.mjs`: integración SQLite/Harness sin proveedor de modelo real.

**Interfaces:**
- Consume: job durable y `harness.watchDoc(LiveDoc, conversationId, context)` de Pi Durable.
- Produce: `watchJobActivity(jobId: string, onUpdate: (activity: JobActivity) => void): Promise<{ initial: JobActivity; close(): Promise<void> } | undefined>`. `JobActivity` es proyección allowlisted: tools activas `{ callId, name }[]`, generación `{ attempt, retryAt?, pollAt? }?` y compactaciones `{ blocking, attempt, retryAt? }[]`. Job terminal o sin conversación devuelve `undefined`; close es idempotente y espera el callback admitido antes de liberar la frontera.

- [x] T007 [US2] Escribir pruebas de integración fallidas para snapshot, reemplazo y cierre — alcance: `src/runtime/session.ts, tests/session-widget-observation.test.mjs`

Añadir `snapshot inicial expone actividad confirmada sin cuerpo`, `watch publica reemplazos sin duplicar tools`, `job sin conversacion no crea watch` y `close detiene y drena callbacks`. Usar Harness/SQLite real, documento LiveDoc y contenido centinela sensible; no invocar proveedor/modelo.

- [x] T008 [US2] Ejecutar las pruebas para confirmar el fallo — alcance: `src/runtime/session.ts, tests/session-widget-observation.test.mjs`

Ejecutar: `node --test tests/session-widget-observation.test.mjs`
Esperado: falla porque SessionRuntime no expone la capacidad de observación.

- [x] T009 [US2] Implementar la frontera y proyección — alcance: `src/runtime/session.ts, tests/session-widget-observation.test.mjs`

Resolver el JobRecord dentro de `openSessionRuntime`; adquirir `LiveDoc`, proyectar snapshot y callbacks como reemplazos, iniciar `watch.start()` y devolver cleanup idempotente. Si el job no existe, no está activo o carece de conversación, devolver `undefined`. No acceder a transcript ni copiar valores excluidos a errores/reportes.

- [x] T010 [US2] Ejecutar integración y regresión de runtime — alcance: `src/runtime/session.ts, tests/session-widget-observation.test.mjs`

Ejecutar `node --test tests/session-widget-observation.test.mjs tests/session-runtime.test.mjs`, luego `npm run check` y `npm test`.
Esperado vigente: integración, check y suite completa pasan. El fallo por host 1.0.4
pertenece al baseline antiguo; cualquier fallo actual bloquea.

### Bloque 3: Etapa B — actividad en widget y degradación segura

**Archivos:**
- Modificar `src/adapters/pi/subagents-widget.ts`: reconciliar observadores para máximo cuatro filas activas y renderizar actividad allowlisted.
- Modificar `src/adapters/pi/register.ts`: conectar la capacidad B del runtime al controlador, manteniendo cleanup ordenado.
- Ampliar `tests/pi-subagentes-widget.test.mjs` y `tests/pi-adapters.test.mjs`.
- Modificar `README.md`, `docs/ARCHITECTURE.md`, `specs/010-interfaz-operativa/spec.md`, `specs/ROADMAP.md` y `specs/README.md` tras aceptación de B, documentando A/B sin desbloquear la interfaz completa ni alterar las dependencias.

**Interfaces:**
- Consume: `SessionRuntime.watchJobActivity()` de la tarea 2.
- Produce: modelo de vista del widget con actividad compacta reemplazable; sin nuevas APIs públicas del paquete ni estados de dominio.

- [x] T011 [US2] Escribir pruebas fallidas para prioridad, degradación y carreras — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md, specs/010-interfaz-operativa/spec.md, specs/ROADMAP.md, specs/README.md`

Añadir `proyecta tools simultaneas por callId y prioridad estable`, incluyendo nombres repetidos y slots pending/running/done; `muestra retry deferred y compactacion sin progreso`, `observador ausente degrada solo actividad y reintenta en siguiente consulta`, `terminal durable prevalece sobre callback tardio`, `maximo cuatro watches y retiro cierra recursos`, y `PI_AGENTS_ANIMATION=0 conserva consulta y contenido estatico`. Comprobar que el spinner comparte el presupuesto 250 ms y sus cuatro frames no cambian contador de consultas ni watches.

- [x] T012 [US2] Ejecutar las pruebas para confirmar el fallo — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md, specs/010-interfaz-operativa/spec.md, specs/ROADMAP.md, specs/README.md`

Ejecutar: `node --test tests/pi-subagentes-widget.test.mjs`
Esperado: falla porque el modelo del widget aún no integra observaciones.

- [x] T013 [US2] Implementar reconciliación y render de B — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md, specs/010-interfaz-operativa/spec.md, specs/ROADMAP.md, specs/README.md`

Al completar una consulta exitosa, adquirir/cerrar watches para jobs activos visibles; representar snapshot y callbacks como reemplazos, validar generación/selección antes de publicar y degradar errores a «actividad no disponible». Mantener estado durable y frescura como autoridad; no reintentar en bucle inmediato.

- [x] T014 [US2] Ejecutar gates automatizados completos — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md, specs/010-interfaz-operativa/spec.md, specs/ROADMAP.md, specs/README.md`

Ejecutar `node --test tests/pi-subagentes-widget.test.mjs tests/session-widget-observation.test.mjs tests/pi-adapters.test.mjs`, `npm run check`, `npm test` y `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`.
Esperado vigente: pruebas de B, smoke, check y suite completa pasan; drenar recursos
propios al cerrar. El fallo antiguo de host no es excepción de este cierre. No declarar
completa ninguna tarea mientras haya gates rojos.

- [x] T015 [US2] Aceptación manual de B — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md, specs/010-interfaz-operativa/spec.md, specs/ROADMAP.md, specs/README.md`

En Pi TUI desde cwd no relacionado, verificar al menos dos tools simultáneas, generación, estado de espera/compactación cuando reproducible, contenido hostil/centinela, retiro y reapertura/cambio de sesión. Documentar cuáles señales fueron realmente observadas; no presentar escenarios no reproducidos como pruebas realizadas. La aceptación de este cierre usa el host probado Pi 1.1.0; no acredita Pi 1.0.4
ni otras versiones, y no exige ese host histórico como gate actual.
Cierre: confirmación humana de la guía local faux el 2026-10-09; dos bash reales,
transición 2→1, lifecycle, tema/anchos y movimiento reducido declarados sin fallos.
Compactación de hijo/retry automático/deferred y contenido hostil/centinela conservan
cobertura automatizada; no se atribuye observación TUI de señales no inducidas.

- [x] T016 [US2] Documentar visto bueno conjunto A+B y revisar diff completo — alcance: `src/adapters/pi/subagents-widget.ts, src/adapters/pi/register.ts, tests/pi-subagentes-widget.test.mjs, tests/pi-adapters.test.mjs, docs/ARCHITECTURE.md, specs/010-interfaz-operativa/spec.md, specs/ROADMAP.md, specs/README.md`

Actualizar README y arquitectura solo con comportamiento aceptado; revisar los AC-W-01…21 contra tests, ejecución y aceptación humana. Ejecutar `git diff --check`, `npm run check` y `npm test`; no incluir ni stagear cambios preexistentes ajenos.

---

## Dependencies & Execution Order

- Mantener el orden de bloques y de pasos del original; cada paso depende del anterior.
- No se asigna [P]: no se ha demostrado independencia de archivos ni contratos durante la migración.
- Para widget: excepción humana de aceptación conjunta registrada; cerrar UI no cancela jobs.
- Pruebas rojas/verdes, migración, privacidad y aceptación conservan sus gates originales.
- Commits y promoción requieren autorización explícita; describirlos no autoriza ejecutarlos.

### Trazabilidad de bloques originales

| Bloque original | Historia | IDs importados |
| --- | --- | --- |
| Bloque 1 | US1 | T001–T006 |
| Bloque 2 | US2 | T007–T010 |
| Bloque 3 | US2 | T011–T016 |

## Implementation Strategy

Ejecutar solo después de confirmar autoridad y el estado actual del trabajo. Verificar el escenario
independiente de cada historia, registrar versiones/comandos/resultados y detenerse ante fallos.
No cerrar fases por marcar casillas ni sustituir revisión independiente o aceptación humana por mocks.

## Notes

Original completo: [archivo histórico](../_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-08-widget-subagentes.md).
Las discrepancias de estado se registran en [MIGRATION.md](../MIGRATION.md), no se resuelven
inventando comprobaciones, cambiando casillas o implementando funciones.
