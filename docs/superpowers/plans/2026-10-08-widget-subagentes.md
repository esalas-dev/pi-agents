# Widget de subagentes A+B — Plan de implementación

> **Para agentes implementadores:** subskill requerida: `superpowers:executing-plans` para ejecución nativa, o `superpowers:subagent-driven-development` para ejecución con subagentes. Ejecutar cada tarea en orden; las casillas registran progreso.

**Objetivo:** Mostrar automáticamente sobre el editor de Pi un widget compacto con estado durable, duración y spinner (A), y después actividad técnica allowlisted observada desde LiveDoc (B).

**Arquitectura:** El adaptador Pi conserva la autoridad del runtime y monta/retira una proyección de UI solo en TUI. A consulta los servicios existentes; B añade en `SessionRuntime` una frontera estrecha que resuelve job→conversación y devuelve únicamente actividad proyectada. El componente no accede a SQLite, Harness, transcript ni contenido de mensajes.

**Stack:** TypeScript del paquete, APIs públicas de Pi 1.1.0 y Pi Durable 1.0.1; pruebas Node `node:test`, reloj/timers controlados y Harness SQLite real para B. Sin dependencias nuevas.

**Spec:** [`docs/superpowers/specs/2026-10-08-widget-subagentes-design.md`](../specs/2026-10-08-widget-subagentes-design.md)

**Estado actualizado — 2026-10-09:** implementación A+B en `80d63d0`, instalada y con visto bueno humano. Prueba real completada y resultado leído tras aprobación TUI; ampliación de casos especiales limitada explícitamente a pruebas automatizadas: 60/60 focales, 321/321 suite y check verde. La [matriz de aceptación](../../WIDGET-ACCEPTANCE.md) registra alcance y límites. Las casillas de ejercicios manuales extensos no se completan mediante tests ni mediante el visto bueno genérico.

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
- El 2026-10-09 el usuario autorizó implementar B antes de la aceptación TUI de A y pidió decidir la aceptación de A+B conjuntamente al final. Mantener evidencia y criterios de cada etapa separados; no afirmar aceptación parcial ni detenerse tras A.
- El fallo original de `tests/host-resolution.test.mjs` (host 1.1.0 frente al antiguo objetivo 1.0.4) pertenece al baseline histórico y se preserva en el respaldo local. La consolidación usa la detección/alineación del host ya presente en main, sin omitir ni modificar ese gate por el widget ni acreditar soporte 1.0.4.

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
- Crear `tests/pi-subagentes-widget.test.mjs`: reloj y servicios controlados para controlador/render.
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

- [x] **Paso 4: Ejecutar gates automatizados de A**

Ejecutar `node --test tests/pi-subagentes-widget.test.mjs tests/pi-adapters.test.mjs`, `npm run check`, `npm test` y el smoke de carga documentado en README: `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`.
Resultado histórico del port contra `origin/main` `bfea4c7` (registrado al final): pruebas de A, check y suite pasan en Pi 1.1.0. El fallo previo de host-version está preservado como evidencia histórica, no como estado actual ni como prueba de compatibilidad 1.0.4. No marcar aceptación humana a partir de estos gates.

- [ ] **Paso 5: Aceptación manual de A y pausa de revisión**

En Pi TUI instalado 1.1.0 desde cwd no relacionado: comprobar jobs activos/cola, retirar al vaciar tras lectura exitosa, mantener editor/foco y cambiar/reabrir sesión. Registrar host/versiones y resultado; no afirmar 1.0.4. Por instrucción humana del 2026-10-09, diferir la aceptación de A hasta la validación conjunta A+B tras Task 3; continuar con B sin pausa.

- [x] **Paso 6: Diferir documentación de aceptación hasta A+B**

No presentar A como aceptada ni actualizar README/arquitectura con aceptación antes del gate conjunto A+B; tras aceptarlo, documentar ambas etapas y sus límites; ejecutar `git diff --check` y revisar que no atribuyan actividad de B.

### Task 2: Etapa B — frontera de observación Durable

**Archivos:**
- Modificar `src/runtime/session.ts`: exponer `watchJobActivity(jobId, onUpdate)` sin exponer Harness ni conversationId.
- Crear `tests/session-widget-observation.test.mjs`: integración SQLite/Harness sin proveedor de modelo real.

**Interfaces:**
- Consume: job durable y `harness.watchDoc(LiveDoc, conversationId, context)` de Pi Durable.
- Produce: `watchJobActivity(jobId: string, onUpdate: (activity: JobActivity) => void): Promise<{ initial: JobActivity; close(): Promise<void> } | undefined>`. `JobActivity` es proyección allowlisted: tools activas `{ callId, name }[]`, generación `{ attempt, retryAt?, pollAt? }?` y compactaciones `{ blocking, attempt, retryAt? }[]`. Job terminal o sin conversación devuelve `undefined`; close es idempotente y espera el callback admitido antes de liberar la frontera.

- [x] **Paso 1: Escribir pruebas de integración fallidas para snapshot, reemplazo y cierre**

Añadir `snapshot inicial expone actividad confirmada sin cuerpo`, `watch publica reemplazos sin duplicar tools`, `job sin conversacion no crea watch` y `close detiene y drena callbacks`. Usar Harness/SQLite real, documento LiveDoc y contenido centinela sensible; no invocar proveedor/modelo.

- [x] **Paso 2: Ejecutar las pruebas para confirmar el fallo**

Ejecutar: `node --test tests/session-widget-observation.test.mjs`
Esperado: falla porque SessionRuntime no expone la capacidad de observación.

- [x] **Paso 3: Implementar la frontera y proyección**

Resolver el JobRecord dentro de `openSessionRuntime`; adquirir `LiveDoc`, proyectar snapshot y callbacks como reemplazos, iniciar `watch.start()` y devolver cleanup idempotente. Si el job no existe, no está activo o carece de conversación, devolver `undefined`. No acceder a transcript ni copiar valores excluidos a errores/reportes.

- [x] **Paso 4: Ejecutar integración y regresión de runtime**

Ejecutar `node --test tests/session-widget-observation.test.mjs tests/session-runtime.test.mjs`, luego `npm run check` y `npm test`.
Resultado histórico del port contra `origin/main` `bfea4c7`: integración y check pasan; ver conteo de suite en el registro final. El baseline previo de host-version está preservado en el respaldo.

### Task 3: Etapa B — actividad en widget y degradación segura

**Archivos:**
- Modificar `src/adapters/pi/subagents-widget.ts`: reconciliar observadores para máximo cuatro filas activas y renderizar actividad allowlisted.
- Modificar `src/adapters/pi/register.ts`: conectar la capacidad B del runtime al controlador, manteniendo cleanup ordenado.
- Ampliar `tests/pi-subagentes-widget.test.mjs` y `tests/pi-adapters.test.mjs`.
- Modificar `README.md`, `docs/ARCHITECTURE.md`, `specs/10-interfaz-operativa.md`, `specs/ROADMAP.md` y `specs/README.md` tras aceptación de B, documentando A/B sin desbloquear la interfaz completa ni alterar las dependencias.

**Interfaces:**
- Consume: `SessionRuntime.watchJobActivity()` de la tarea 2.
- Produce: modelo de vista del widget con actividad compacta reemplazable; sin nuevas APIs públicas del paquete ni estados de dominio.

- [x] **Paso 1: Escribir pruebas fallidas para prioridad, degradación y carreras**

Añadir `proyecta tools simultaneas por callId y prioridad estable`, incluyendo nombres repetidos y slots pending/running/done; `muestra retry deferred y compactacion sin progreso`, `observador ausente degrada solo actividad y reintenta en siguiente consulta`, `terminal durable prevalece sobre callback tardio`, `maximo cuatro watches y retiro cierra recursos`, y `PI_AGENTS_ANIMATION=0 conserva consulta y contenido estatico`. Comprobar que el spinner comparte el presupuesto 250 ms y sus cuatro frames no cambian contador de consultas ni watches.

- [x] **Paso 2: Ejecutar las pruebas para confirmar el fallo**

Ejecutar: `node --test tests/pi-subagentes-widget.test.mjs`
Esperado: falla porque el modelo del widget aún no integra observaciones.

- [x] **Paso 3: Implementar reconciliación y render de B**

Al completar una consulta exitosa, adquirir/cerrar watches para jobs activos visibles; representar snapshot y callbacks como reemplazos, validar generación/selección antes de publicar y degradar errores a «actividad no disponible». Mantener estado durable y frescura como autoridad; no reintentar en bucle inmediato.

- [x] **Paso 4: Ejecutar gates automatizados completos**

Ejecutar `node --test tests/pi-subagentes-widget.test.mjs tests/session-widget-observation.test.mjs tests/pi-adapters.test.mjs`, `npm run check`, `npm test` y `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__`.
Resultado histórico del port contra `origin/main` `bfea4c7`: pruebas de B, check y suite pasan en Pi 1.1.0 (un test omitido entonces por limitación conocida de Harness). El baseline previo está preservado. Esto no reemplaza aceptación TUI ni valida Pi 1.0.4.

- [ ] **Paso 5: Aceptación manual conjunta de A+B**

En Pi TUI desde cwd no relacionado, validar conjuntamente A+B: filas activas/cola, editor/foco, retiro/sesiones y, para B, al menos dos tools simultáneas, generación, espera/compactación cuando reproducible, contenido hostil/centinela y cleanup. Documentar cuáles señales fueron realmente observadas; no presentar escenarios no reproducidos como pruebas realizadas. Pi 1.0.4 sigue siendo un gate de compatibilidad separado.

- [x] **Paso 6: Documentar A+B aceptadas y revisar diff completo**

Tras recibir visto bueno humano conjunto, se actualizan README y arquitectura y se registra la matriz AC-W-01…21 con pruebas y límites observados. La decisión humana no sustituye escenarios manuales no ejercitados ni revisión independiente. Verificar `git diff --check`, `npm run check` y `npm test`; no incluir ni stagear cambios preexistentes ajenos.

---

## Handoff y estado

Spec y plan aprobados humanamente el 2026-10-08; método elegido: Native. El 2026-10-09 el usuario autorizó B antes de aceptar A y aplazó la decisión humana hasta revisar A+B juntas. El smoke de APIs no equivale a aceptación TUI ni a soporte Pi 1.0.4. Ejecutar en worktree aislado; no iniciar otras capacidades de fase 10.

### Port histórico a `main`

Se portó A+B al worktree `.worktrees/widget-subagentes-main`, rama `feature/widget-subagents-a-b-main`, partiendo de `origin/main` `bfea4c70015bef21899842fa25d9f6cbf22b6dcd`; `git fetch origin main` confirmó que ese hash seguía vigente durante la validación. Se adaptó la frontera al lifecycle nuevo y a schema 5; no se tocaron outbox, RPC ni semántica durable de jobs.

Verificación observada: `npm run check` pasa con host Pi 1.1.0; `npm test` da 240 pass, 0 fail y 1 skip conocido (`Harness.close()` espera `TaskScheduler.join()` en Pi Durable 1.0.1); smoke offline `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__` carga la extensión; `git diff --check` pasa. La aceptación TUI conjunta A+B, un job real de subagente y compatibilidad con Pi 1.0.4 siguen pendientes.

### Consolidación posterior con revisión parental — 2026-10-09

El usuario autorizó reunir ambos borradores en un único worktree y eligió conservar `.worktrees/widget-subagentes`, rama `feature/widget-subagents-a-b`, manteniendo la referencia instalada de Pi. Se incorpora mediante merge normal el último `origin/main` verificado: `29905ee25fe1f2601f5d34320cf1d1b41b6e4706` (PR #10). El port anterior se usa como fuente, no se fusionan a ciegas dos implementaciones duplicadas. Retirada del worktree secundario solo tras gates y respaldo verificado; su rama permanece.

La integración conserva la fábrica inyectable original, el controlador y las pruebas A+B comunes, y las adaptaciones de fixtures a schema 5 del port. El observador se adapta a `seal()/retire()/close()`: niega adquisiciones/publicaciones después de sellar y drena adquisiciones/watches antes de iniciar close SDK. Retire no espera al proveedor; close no libera el lease antes del cierre real. La limpieza sella RPC antes de esperar al widget. Revisión parental, precedencia humana, ledger, outbox, migraciones y cliente T9 permanecen intactos frente a main.

Autorrevisión focal, no independiente: se corrigen con RED→GREEN dos defectos previos — slots pending presentados como tools en ejecución y handles terminados retenidos por el Set del runtime. Regresiones para snapshot/callbacks, sellado, adquisición/cierre admitidos y cierre de observación con proveedor faux bloqueado. Baseline integrado: 289/289 y check verde. La verificación final, pack y protección de root/settings se registran en evidencia local ignorada `.superpowers/widget-consolidation-20261009T173147Z/`.

Estado al crear el commit de consolidación `80d63d0` (histórico): sin smoke Pi nuevo, TUI, proveedor real, migración de datos reales, instalación, reload ni publicación; entonces seguían pendientes aceptación y revisión independiente. Este párrafo no describe los hechos posteriores.

### Aprobación y ampliación automatizada — 2026-10-09

Después se confirmó el registro personal desde la ruta conservada, se ejecutó `parent-review-reviewer` y se leyó su resultado terminal con `consume:false` tras aprobación TUI humana. La persona responsable confirmó el visto bueno visual A+B y posteriormente «apruebo»; [WIDGET-ACCEPTANCE](../../WIDGET-ACCEPTANCE.md) registra esa decisión, no una inspección visual del asistente ni revisión del código por ese subagente.

Por elección humana, los casos especiales se amplían solo automatizadamente, sin perfil temporal ni nuevos subagentes: Unicode/temas, CSI/OSC, parada y reanudación de animación por frescura, adquisición/callback tardíos bajo la misma clave, dos tools running con nombres repetidos en LiveDoc, precedencia de compactación/espera y un índice SQLite de 2.000 jobs con resultados voluminosos. No cambia ningún archivo productivo.

Resultados: 60/60 focales, 321/321 suite, sin skips/fallos/cancelaciones, check verde con host Pi 1.1.0 y smoke CLI aislado exit 0 sin modelos disponibles. La matriz separa UI controlada de Harness/SQLite y de la única prueba remota previa. La evidencia interactiva especial y la revisión independiente siguen pendientes. Al cerrar esta ampliación automatizada no se habían hecho commit/push/merge, migraciones reales ni promoción de fase 10. La solicitud posterior «crea PR» autoriza confirmar documentación/pruebas y publicar normalmente la rama contra `main`; no autoriza merge, migraciones ni promoción de fase.
