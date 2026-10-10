# Widget de subagentes A+B — Plan de implementación

> **Para agentes implementadores:** subskill requerida: `superpowers:executing-plans` para ejecución nativa, o `superpowers:subagent-driven-development` para ejecución con subagentes. Ejecutar cada tarea en orden; las casillas registran progreso.

**Objetivo:** Mostrar automáticamente sobre el editor de Pi un widget compacto con estado durable, duración y spinner (A), y después actividad técnica allowlisted observada desde LiveDoc (B).

**Arquitectura:** El adaptador Pi conserva la autoridad del runtime y monta/retira una proyección de UI solo en TUI. A consulta los servicios existentes; B añade en `SessionRuntime` una frontera estrecha que resuelve job→conversación y devuelve únicamente actividad proyectada. El componente no accede a SQLite, Harness, transcript ni contenido de mensajes.

**Stack:** TypeScript del paquete, APIs públicas de Pi 1.1.0 y Pi Durable 1.0.1; pruebas Node `node:test`, reloj/timers controlados y Harness SQLite real para B. Sin dependencias nuevas.

**Spec:** [`docs/superpowers/specs/2026-10-08-widget-subagentes-design.md`](../specs/2026-10-08-widget-subagentes-design.md)

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

### Task 1: Etapa A — consulta, visibilidad y widget compacto

**Archivos:**
- Crear `src/adapters/pi/subagents-widget.ts`: controlador, selección, render y lifecycle del componente.
- Modificar `src/adapters/pi/register.ts`: iniciar el controlador tras abrir runtime en TUI y detenerlo antes de cerrar/cambiar runtime.
- Crear `tests/pi-subagents-widget.test.mjs`: reloj y servicios controlados para controlador/render.
- Modificar `tests/pi-adapters.test.mjs`: registro y lifecycle por modo.
- Modificar `README.md` y `docs/ARCHITECTURE.md` solo cuando A pase aceptación; describir A sin afirmar B.

**Interfaces:**
- Consume: `JobsService.listJobs(filter)` y `ExtensionContext.ui.setWidget()` ya existentes; `JobListView`, `publicStatus()` y utilidades públicas de `@earendil-works/pi-tui`.
- Produce: `createSubagentsWidget(options): { start(): void; close(): Promise<void> }`, interno al adaptador. `options` recibe `jobs: Pick<JobsService, "listJobs">`, `ui: Pick<ExtensionContext["ui"], "setWidget">` y reloj/timers reemplazables en pruebas. El controlador posee consulta y timers; la fábrica crea el componente cuando Pi monta el widget.

- [x] **Paso 1: Escribir pruebas fallidas para estados, visibilidad y lifecycle**

Añadir `selecciona activos antes que cola, limita cuatro filas y señala continuacion`, `solo retira el widget tras consulta exitosa vacia`, `fallo conserva seleccion previa marcada desactualizada`, `consulta lenta no se solapa y expira frescura`, `duracion usa startedAt y no inventa cola`, `render en anchos 20 40 80 conserva estado tema y Unicode`, `sanitiza CSI OSC y controles`, `stop cancela timers y rechaza callbacks tardios incluso tras reabrir el mismo sessionId`, `rpc con hasUI no monta widget` y `widget no muta jobs ni consume resultados`. Afirmar filtros exactos, montaje/retirada, 250 ms y secuencia `| / - \\`, movimiento reducido, queued/paused y datos desactualizados estáticos, ausencia de cursor-following y ausencia de datos centinela de tarea/cwd/resultados.

- [x] **Paso 2: Ejecutar las pruebas para confirmar el fallo**

Ejecutar: `node --test tests/pi-subagentes-widget.test.mjs`
Esperado: falla porque el controlador/widget aún no existe.

- [x] **Paso 3: Implementar controlador y render de A**

Crear `createSubagentsWidget` en `src/adapters/pi/subagents-widget.ts`; mantener modelo de vista acotado, dos consultas por conjunto, refresco serial y timer solo tras resolver la lectura previa. Integrar en `register.ts` con guardia TUI exacta y cleanup antes del runtime.

- [ ] **Paso 4: Ejecutar gates automatizados de A**

Ejecutar `node --test tests/pi-subagentes-widget.test.mjs tests/pi-adapters.test.mjs`, `npm run check`, `npm test` y el smoke de carga documentado en README: `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`.
Esperado: pruebas de A y smoke pasan; `npm run check` pasa; `npm test` mantiene únicamente el fallo preexistente de `host-resolution.test.mjs`, que exige 1.0.4 (baseline previo 98/99; tras agregar pruebas A, 109/110). Investigar y reportar cualquier falla adicional. El método puede continuar por autorización humana, pero no marcar completa la tarea mientras la suite siga roja.

- [ ] **Paso 5: Aceptación manual de A y pausa de revisión**

En Pi TUI instalado 1.1.0 desde cwd no relacionado: comprobar jobs activos/cola, retirar al vaciar tras lectura exitosa, mantener editor/foco y cambiar/reabrir sesión. Registrar host/versiones y resultado; no afirmar 1.0.4. Esperar aceptación humana de A antes de iniciar B.

- [ ] **Paso 6: Documentar A aceptada**

Actualizar README y arquitectura solo con comportamiento observado/implementado de A y sus límites; ejecutar `git diff --check` y revisar que no atribuyan actividad de B.

### Task 2: Etapa B — frontera de observación Durable

**Archivos:**
- Modificar `src/runtime/session.ts`: exponer `watchJobActivity(jobId, onUpdate)` sin exponer Harness ni conversationId.
- Crear `tests/session-widget-observation.test.mjs`: integración SQLite/Harness sin proveedor de modelo real.

**Interfaces:**
- Consume: job durable y `harness.watchDoc(LiveDoc, conversationId, context)` de Pi Durable.
- Produce: `watchJobActivity(jobId: string, onUpdate: (activity: JobActivity) => void): Promise<{ initial: JobActivity; close(): Promise<void> } | undefined>`. `JobActivity` es proyección allowlisted: tools activas `{ callId, name }[]`, generación `{ attempt, retryAt?, pollAt? }?` y compactaciones `{ blocking, attempt, retryAt? }[]`. Job terminal o sin conversación devuelve `undefined`; close es idempotente y espera el callback admitido antes de liberar la frontera.

- [ ] **Paso 1: Escribir pruebas de integración fallidas para snapshot, reemplazo y cierre**

Añadir `snapshot inicial expone actividad confirmada sin cuerpo`, `watch publica reemplazos sin duplicar tools`, `job sin conversacion no crea watch` y `close detiene y drena callbacks`. Usar Harness/SQLite real, documento LiveDoc y contenido centinela sensible; no invocar proveedor/modelo.

- [ ] **Paso 2: Ejecutar las pruebas para confirmar el fallo**

Ejecutar: `node --test tests/session-widget-observation.test.mjs`
Esperado: falla porque SessionRuntime no expone la capacidad de observación.

- [ ] **Paso 3: Implementar la frontera y proyección**

Resolver el JobRecord dentro de `openSessionRuntime`; adquirir `LiveDoc`, proyectar snapshot y callbacks como reemplazos, iniciar `watch.start()` y devolver cleanup idempotente. Si el job no existe, no está activo o carece de conversación, devolver `undefined`. No acceder a transcript ni copiar valores excluidos a errores/reportes.

- [ ] **Paso 4: Ejecutar integración y regresión de runtime**

Ejecutar `node --test tests/session-widget-observation.test.mjs tests/session-runtime.test.mjs`, luego `npm run check` y `npm test`.
Esperado: integración y check pasan; la suite mantiene únicamente el baseline conocido de `host-resolution.test.mjs` (Pi instalado 1.1.0 frente a 1.0.4 requerido). Cualquier otra falla bloquea.

### Task 3: Etapa B — actividad en widget y degradación segura

**Archivos:**
- Modificar `src/adapters/pi/subagents-widget.ts`: reconciliar observadores para máximo cuatro filas activas y renderizar actividad allowlisted.
- Modificar `src/adapters/pi/register.ts`: conectar la capacidad B del runtime al controlador, manteniendo cleanup ordenado.
- Ampliar `tests/pi-subagentes-widget.test.mjs` y `tests/pi-adapters.test.mjs`.
- Modificar `README.md`, `docs/ARCHITECTURE.md`, `specs/10-interfaz-operativa.md`, `specs/ROADMAP.md` y `specs/README.md` tras aceptación de B, documentando A/B sin desbloquear la interfaz completa ni alterar las dependencias.

**Interfaces:**
- Consume: `SessionRuntime.watchJobActivity()` de la tarea 2.
- Produce: modelo de vista del widget con actividad compacta reemplazable; sin nuevas APIs públicas del paquete ni estados de dominio.

- [ ] **Paso 1: Escribir pruebas fallidas para prioridad, degradación y carreras**

Añadir `proyecta tools simultaneas por callId y prioridad estable`, incluyendo nombres repetidos y slots pending/running/done; `muestra retry deferred y compactacion sin progreso`, `observador ausente degrada solo actividad y reintenta en siguiente consulta`, `terminal durable prevalece sobre callback tardio`, `maximo cuatro watches y retiro cierra recursos`, y `PI_AGENTS_ANIMATION=0 conserva consulta y contenido estatico`. Comprobar que el spinner comparte el presupuesto 250 ms y sus cuatro frames no cambian contador de consultas ni watches.

- [ ] **Paso 2: Ejecutar las pruebas para confirmar el fallo**

Ejecutar: `node --test tests/pi-subagentes-widget.test.mjs`
Esperado: falla porque el modelo del widget aún no integra observaciones.

- [ ] **Paso 3: Implementar reconciliación y render de B**

Al completar una consulta exitosa, adquirir/cerrar watches para jobs activos visibles; representar snapshot y callbacks como reemplazos, validar generación/selección antes de publicar y degradar errores a «actividad no disponible». Mantener estado durable y frescura como autoridad; no reintentar en bucle inmediato.

- [ ] **Paso 4: Ejecutar gates automatizados completos**

Ejecutar `node --test tests/pi-subagentes-widget.test.mjs tests/session-widget-observation.test.mjs tests/pi-adapters.test.mjs`, `npm run check`, `npm test` y `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`.
Esperado: pruebas de B y smoke pasan, sin recursos propios tras cerrar; `npm run check` pasa y la suite conserva únicamente el baseline conocido de `host-resolution.test.mjs`. No declarar completa ninguna tarea mientras `npm test` siga roja.

- [ ] **Paso 5: Aceptación manual de B**

En Pi TUI desde cwd no relacionado, verificar al menos dos tools simultáneas, generación, estado de espera/compactación cuando reproducible, contenido hostil/centinela, retiro y reapertura/cambio de sesión. Documentar cuáles señales fueron realmente observadas; no presentar escenarios no reproducidos como pruebas realizadas. Pi 1.0.4 sigue siendo un gate de compatibilidad separado.

- [ ] **Paso 6: Documentar B aceptada y revisar diff completo**

Actualizar README y arquitectura solo con comportamiento aceptado; revisar los AC-W-01…21 contra tests, ejecución y aceptación humana. Ejecutar `git diff --check`, `npm run check` y `npm test`; no incluir ni stagear cambios preexistentes ajenos.

---

## Handoff y estado

Spec y plan aprobados humanamente el 2026-10-08; método elegido: Native. El smoke de APIs no equivale a aceptación TUI ni a soporte Pi 1.0.4. La tarea 1 empieza en worktree aislado; no iniciar B hasta la aceptación TUI humana de A.