# Diseño — Widget de subagentes en la terminal de Pi

## Estado y autoridad del documento

**Spec y plan aprobados humanamente el 2026-10-08; método de ejecución: Native.** Fecha de redacción: 2026-10-08, fecha local del entorno. El usuario eligió visualizar dentro de Pi, autorizó adelantar A+B como excepción y aprobó ambos documentos antes de implementar. Durante la revisión solicitó incluir animación; se incorpora un spinner desde A. El 2026-10-09 autorizó implementar B antes de aceptar A y decidir la aceptación humana de ambas etapas conjuntamente al final; los criterios y evidencias A/B siguen siendo independientes.

Esta spec define una entrega acotada de observabilidad en dos etapas. No sustituye la interfaz operativa completa de [fase 10](../../../specs/10-interfaz-operativa.md), ni da por implementados los eventos y RPC de [fase 03](2026-10-07-fase-03-eventos-rpc-design.md).

El [roadmap](../../../specs/ROADMAP.md) y el [índice normativo](../../../specs/README.md) conservan la dependencia de fase 10 respecto de 01–09 para la interfaz operativa completa. El 2026-10-08 el usuario autorizó una excepción limitada a las etapas A y B de este widget y aprobó esta spec y su plan. No adelanta el resto de fase 10.

Base inspeccionada durante la redacción: HEAD `e0d0a990038ab41e3826f5b4031e8a2f663817d7`, con cambios locales preexistentes; no se considera un checkout limpio ni una nueva aceptación del runtime. Pi instalado: `1.1.0`; Pi Durable local: `1.0.1`; Node observado durante el análisis: `26.10.0`. El README de aquel baseline mantenía Pi `1.0.4` como host objetivo. No se amplía la compatibilidad declarada mediante este documento.

Consolidación autorizada el 2026-10-09: ambos borradores se reúnen sobre main `29905ee` en la ruta instalada `.worktrees/widget-subagentes`. El README de main ya usa detección del host (evidencia Pi 1.1.0), no el antiguo objetivo fijo. El observador se integra con sellado y retirada en dos fases; se conserva el lease hasta el cierre SDK real. Esto es integración local y validación automatizada, no aceptación TUI ni ampliación de compatibilidad; ver el [registro del plan](../plans/2026-10-08-widget-subagentes.md#consolidación-posterior-con-revisión-parental--2026-10-09).

Actualización de aprobación y evidencia — 2026-10-09: A+B está implementado en `80d63d0`, instalado y con visto bueno humano al widget, confirmado junto con la aprobación del resultado de una prueba real. La ampliación posterior se autorizó **solo automatizada**: 60/60 focales, 321/321 suite y check verde. La [matriz AC-W y sus límites](../../WIDGET-ACCEPTANCE.md) distingue esa decisión de los escenarios TUI no observados; no acredita revisión independiente, compatibilidad adicional ni promoción de fase 10.

## 1. Intención y criterio de éxito

Permitir que la persona que trabaja en la TUI principal de Pi vea qué subagentes de **esa sesión** siguen pendientes o ejecutándose, cuánto tiempo llevan en ejecución y, en la segunda etapa, qué actividad técnica se observa. La vista debe mantenerse actualizada sin ocupar el editor, lanzar otro modelo ni exigir consultas manuales repetidas.

Éxito significa distinguir claramente:

- **Estado durable del job:** consulta de los servicios existentes, no inferencia del widget.
- **Actividad observada:** generación, herramientas, compactación o espera técnica; no un nuevo estado de negocio.
- **Progreso:** señales de actividad y tiempo transcurrido, no un porcentaje subjetivo de trabajo completado.

La UI es una proyección reconstruible. Observar, ocultar o retirar el widget no cancela jobs, consume resultados, aprueba trabajo ni promociona cambios.

## 2. Alcance y alternativas

| Alternativa | Ventaja | Límite y decisión |
| --- | --- | --- |
| Widget mediante `ctx.ui.setWidget()` | Filas por agente visibles junto al editor, sin sustituir UI del host | Elegida; tamaño acotado y sin foco propio |
| Resumen mediante `ctx.ui.setStatus()` | Integración mínima en el footer | Insuficiente para actividad individual; no se duplica el widget allí |
| Panel mediante `ctx.ui.custom()` | Navegación y detalle interactivo | Se reserva para fase 10; excede esta entrega |

### Etapa A — Estado y duración

- Widget compacto encima del editor, visible cuando hay jobs no terminales.
- Nombre de agente, ID abreviado, estado público, duración activa y posición de cola disponible.
- Spinner en filas activas, con reloj compartido y alternativa estática para movimiento reducido.
- Consulta inicial y refresco periódico de servicios existentes.
- Indicación de más trabajos y de datos desactualizados.
- Conservación de comandos, tools y avisos de finalización actuales.

### Etapa B — Actividad observada

- Añadir observación de estado vivo de las conversaciones de los jobs activos visibles.
- Mostrar herramientas activas, generación, reintento, espera del proveedor y compactación.
- Reconciliar desde snapshot al adquirir o recuperar una observación.
- Degradar explícitamente a estado/duración si la actividad no puede observarse.

La etapa A es una entrega útil pero **no cumple el alcance de actividad de B**. Sus criterios y evidencias se validan por separado, pero, por instrucción humana del 2026-10-09, la decisión de aceptación de A+B se difiere hasta que ambas etapas estén listas.

### Fuera de alcance

Panel interactivo, nuevas acciones de control, configuración persistente, nuevos flags o subcomandos, listado global, historial en el widget, grupos, gates, worktrees, schedules, workflows, porcentaje estimado, animaciones decorativas o temporizadores por job, tokens/costes, streaming de respuestas o stdout, bus de progreso nuevo y monitor externo RPC.

No se añade una dependencia runtime, migración de SQLite ni cambio de los estados públicos para ninguna etapa.

Política de visibilidad común con fase 10: montar el widget automáticamente cuando una consulta exitosa devuelva al menos un job no terminal visible y retirarlo cuando una consulta exitosa no devuelva ninguno. No se muestra un widget vacío ni se añade configuración persistente para activarlo o elegir resumen.

## 3. Presentación y selección de filas

Ejemplo esquemático de B, no captura de una prueba real:

```text
Subagentes · 3 visibles
| psa_7ab…  reviewer     ejecutándose  42 s  · herramienta: read
| psa_92c…  implementer  ejecutándose  18 s  · generando respuesta
○ psa_318…  tester       en cola        —    · posición 1
```

Las barras de las filas activas representan un frame del spinner; el ejemplo es estático. En A se omite la actividad; no se sustituye por una etiqueta que aparente observación real.

### Selección

1. Consultar `listJobs` con estados `running` y `cancelling`, y límite 5.
2. Consultar `listJobs` con estados `queued` y `paused`, y límite 5.
3. Presentar primero el primer conjunto y después el segundo, conservando dentro de cada conjunto el orden del servicio. Mostrar como máximo **4 filas**.
4. Si se omiten filas obtenidas o cualquier página tiene `nextCursor`, añadir «Hay más trabajos: /subagents list».

El widget no sigue cursores ni calcula totales globales. El encabezado informa únicamente las filas visibles. Los filtros impiden que trabajos terminales recientes oculten trabajos activos. El orden público y la paginación existentes no cambian.

Los jobs terminales desaparecen tras la siguiente consulta exitosa; sus avisos y resultados siguen disponibles por las vías existentes. No se mantiene un historial adicional en memoria.

### Campos y formato

- ID corto: abreviación de un prefijo inequívoco entre las filas visibles; el ID completo permanece en el modelo de vista, no se reconstruye desde texto truncado. Si no cabe un prefijo inequívoco, la UI no presenta la abreviación como identificador utilizable y remite al listado existente.
- Estado: texto en español y símbolo; el color es complementario. `provisioning` conserva su proyección pública `running`.
- Duración: para ejecución activa, `max(0, ahora - startedAt)`; si falta `startedAt`, mostrar «—». No usar `createdAt` como inicio de ejecución ni tratar la espera en cola como duración activa.
- Cola: mostrar `queuePosition` solo cuando lo devuelve el servicio; una ausencia no equivale a posición cero.
- Pausa y cancelación: «pausado» y «cancelando», sin afirmar que una ejecución activa puede pausarse ni que la cancelación ya está confirmada.
- Al no existir jobs pendientes, retirar el contenido del widget. La consulta periódica sigue permitiendo descubrir nuevos jobs de la sesión activa.

Máximo 6 líneas: encabezado, 4 filas y una línea compartida para advertencias/continuación. En terminal estrecha se ocultan primero actividad y duración; se preservan símbolo/estado e identificación hasta donde permita el ancho. Si el ancho es insuficiente, usar un resumen de una línea y remitir a `/subagents list`.

### Animación de ejecución

Desde A, reemplazar el símbolo estático de cada fila `running` o `cancelling` por un spinner de una columna con frames `|`, `/`, `-`, `\`, en ese orden. La proyección pública de provisioning puede animarse como running. Mantener siempre el texto del estado: el movimiento solo indica un estado activo en la última consulta confirmada, no avance medido, actividad reciente ni confirmación de cancelación.

- Un **único reloj de animación por widget**, compartido entre todas las filas, avanza un frame cada **250 ms**. No crear un loader o timer por job ni cambiar el loader principal de Pi.
- Animar solo con widget montado, datos durables frescos y al menos una fila activa visible. En el resumen estrecho, como máximo un spinner con la misma condición. Queued y paused mantienen símbolos estáticos; terminales no se animan.
- Ante datos desactualizados, widget retirado o ausencia de filas activas, detener el reloj y usar símbolos estáticos. Una consulta exitosa puede reanudarlo si vuelven a cumplirse las condiciones.
- En B, la indisponibilidad de actividad no invalida un estado durable fresco: el spinner puede seguir, con «actividad no disponible» explícito. No se usa el spinner como sustituto de esa observación.
- Los ticks solo actualizan el frame efímero e invalidan el componente; no consultan servicios, SQLite, transcript o modelos ni emiten eventos. Coalescer animación, consultas y actividad bajo el mismo presupuesto de solicitudes de render.
- Todos los frames ocupan una columna, sin destellos, cambios de color por frame, saltos de layout ni captura de foco. El modo estático conserva toda la información textual.
- Para movimiento reducido, **`PI_AGENTS_ANIMATION=0`** deshabilitará solo el movimiento y el reloj continuo de animación. Ausente u otro valor mantiene animación habilitada cuando corresponde. Es el único ajuste adicional, no persistente; no añade flags, comandos ni un sistema de configuración. El refresco de datos y de actividad continúa agrupado.
- Al disponer, recargar o cambiar sesión, cancelar el reloj junto con los demás recursos. No quedan ticks ni solicitudes de render de una generación anterior; el ritmo vuelve a empezar al montar una instancia nueva.

## 4. Arquitectura y APIs públicas

```text
JobsService.listJobs ───────────► filas y estado durable
                                        │
Etapa B: observador de LiveDoc ─► actividad técnica compacta
                                        │
                               modelo de vista efímero
                                        │
                           componente widget de Pi
```

| Unidad | Responsabilidad | Frontera |
| --- | --- | --- |
| Servicios existentes de jobs | Consulta y semántica durable | No reciben responsabilidades de render |
| Adaptador de observación, solo B | Resolver job → conversación y proyectar `LiveDoc` | Encapsula Harness, contexto y tokens Durable |
| Controlador de widget | Refresco, selección, generación activa, errores y cierre | Consume servicios; nunca ejecuta transiciones |
| Componente TUI | Formato por ancho/tema y líneas acotadas | Sin SQLite, herramientas, modelos ni foco de teclado |

`src/runtime/session.ts` expone `jobs`, `seal()`, `retire()`, `close()` y la capacidad interna B `watchJobActivity()` para observar actividad por ID de job y detener esa observación. No se entrega el Harness, `JobRecord`, contexto Chord ni `conversationId` al componente o a otras extensiones. Los nombres y archivos nuevos se decidirán en el plan, no se consideran existentes.

### Integración con Pi

Registrar una fábrica de componente con `ctx.ui.setWidget("pi-durable-subagents", factory, { placement: "aboveEditor" })` solo en `ctx.mode === "tui" && ctx.hasUI`. La fábrica aporta `render(width)`, `invalidate()` y limpieza idempotente si la necesita. No se crean timers en la fábrica de la extensión ni en `render()`.

El componente calcula estilos durante render con el tema inyectado. Usa `visibleWidth()` y `truncateToWidth()` de `@earendil-works/pi-tui`, no longitud de strings para medir columnas. Al actualizar su modelo, invalidar y solicitar render con el `tui.requestRender()` inyectado. Mantener la instancia mientras esté montada; no reemplazarla por cada token o tick. Retirar el widget vacío permite disponer esa instancia; al reaparecer jobs se monta una nueva dentro de la generación activa.

No sustituir header, footer, editor ni loader de la sesión principal. No crear otro renderer terminal, escribir ANSI directamente en stdout ni interceptar teclas del editor.

Los eventos `pi.on(...)` de la sesión principal y el `onUpdate` de la tool de inicio no son la fuente de actividad: esa llamada retorna al admitir el job y el Harness Durable ejecuta después en un runtime distinto.

## 5. Consulta, refresco y frescura

A consulta inmediatamente tras abrir satisfactoriamente el runtime de sesión. Programa la siguiente consulta **1000 ms después de terminar la anterior**, con reloj/temporizador inyectables en pruebas. No hay consultas superpuestas ni una cola creciente de ticks. Duraciones se actualizan con el reloj, sin mutar documentos.

El listado actual recorre y ordena el índice completo de summaries. Limitar la página acota filas materializadas, **no hace constante el coste de la consulta**. Las pruebas deben registrar operaciones sobre un índice grande y confirmar que no se cargan cuerpos de resultados. Cambiar la estructura del índice o introducir un índice agregado queda fuera de alcance; si el coste impide aceptación interactiva, documentar el bloqueo y proponer el ajuste por separado.

Una lectura exitosa reemplaza las filas de A y reconcilia observaciones de B. No se exige una instantánea transaccional única entre las dos consultas; la siguiente consulta corrige carreras de cambio de estado. No se presenta la selección como censo atómico de la sesión.

Conservar el instante de la última consulta exitosa. Ante fallo de cualquiera de las consultas, no aplicar una selección parcial: conservar la última selección conocida y marcar «Datos desactualizados». Durante una consulta que supera 5 s, mostrar la misma advertencia, sin lanzar otra consulta ni fingir que se canceló la lectura pendiente. Si aún no hubo lectura exitosa, mostrar «Estado no disponible».

Animación, cambios de selección y actividad de B comparten un límite de **una solicitud propia de render por 250 ms** (4 Hz). Agrupar las actualizaciones bajo ese único presupuesto; no sumar otro reloj de render por fuente. El primer montaje y la retirada se aplican de inmediato. En modo estático o sin filas animables no hay reloj continuo de animación; los cambios de datos usan coalescing bajo demanda. Este límite no restringe los renders que Pi necesite por otros componentes. Ni un frame, un evento ni un cierre de conversación convierten por sí solos el job a terminal: siempre prevalece la siguiente consulta durable.

Los eventos de fase 03, cuando estén implementados y validados, podrán invalidar esta vista como optimización posterior. Esta spec no requiere su bus ni modifica su contrato ni duplica su outbox.

## 6. Observación de actividad — Etapa B

### Fuente elegida

Usar `harness.watchDoc(LiveDoc, conversationId, context)`, con `LiveDoc` importado del export público de `@earendil-works/pi-durable`. La observación proporciona estado inicial y sucesivas versiones confirmadas de ese documento. Proyectar únicamente metadatos permitidos y descartar el resto antes de publicar al controlador.

`watchEvents()` es una alternativa pública examinada, pero no se elige: su snapshot incluye entries del transcript y supera las necesidades de este widget. Tampoco se usa `watchTaskGraph()`: sus tasks no corresponden uno a uno con jobs públicos y sus estados no sustituyen los de la aplicación.

Observar como máximo los **4 jobs activos visibles**; queued/paused sin conversación no requieren observador. El runtime resuelve la conversación desde el job durable. Al cambiar selección o terminar un job, detener la observación correspondiente. Una adquisición tardía vuelve a comprobar generación, selección y estado actual antes de publicar.

La UI trata el snapshot inicial y cada callback como **reemplazo** de actividad, no como un delta para acumular contadores. Adjuntarse tarde, recibir frames agrupados o reconectar no duplica herramientas ni exige replay histórico. Retener solo una proyección compacta por job.

### Reglas de proyección

| Dato confirmado de `LiveDoc` | Presentación |
| --- | --- |
| Slots de herramientas con `status === "running"` | Nombre(s) de herramientas activas; conservar identidad por `callId`, no solo la última |
| Generación con `retry` | «esperando reintento», intento y plazo cuando constan; no error libre |
| Generación con `deferred` | «esperando proveedor»; no interpretar el sondeo como porcentaje |
| Compactación con `blocking === true` | «compactando contexto» |
| Generación sin espera anterior | «generando respuesta»; no inferir finalización ni fase semántica de la tarea |
| Solo compactación no bloqueante | «compactación en segundo plano» |
| Ninguna actividad identificable | «sin actividad observable»; no «bloqueado» ni «completado» |

Prioridad de etiqueta principal: herramientas activas, reintento, espera de proveedor, compactación bloqueante, generación, compactación en segundo plano. Esa prioridad solo reduce presentación; la proyección conserva los indicadores simultáneos. En varias herramientas, mostrar nombres hasta el ancho disponible y «+N» para llamadas omitidas; `N` es un conteo de llamadas activas, no porcentaje ni total de jobs.

`ToolSlot.status` pending/done no implica herramienta ejecutándose. Ausencia de texto parcial no prueba inactividad. No se inspecciona ni muestra el contenido de `generation.message`, pensamiento, args, output, details, diagnostics o mensajes libres de error.

### Degradación y recuperación

Si falta conversación durante provisioning, mostrar «actividad aún no disponible» y volver a intentar tras una consulta posterior. Si la observación no puede adquirirse o termina inesperadamente, mantener el estado durable, marcar «actividad no disponible» y reintentar en el siguiente ciclo de consulta. No crear observadores simultáneos duplicados ni reintentar en bucle inmediato.

Si falta una API pública necesaria en el host objetivo, B queda bloqueada; A puede aceptarse por separado sin anunciar actividad. No acceder a campos privados, actualizar Durable sin aprobación ni simular observación real con heurísticas.

`LiveDoc` puede contener texto parcial y salida retenida de herramientas: la API aún debe materializar ese documento antes de proyectarlo. No se promete memoria de adquisición constante ni ausencia de datos sensibles dentro del proceso. Sí se exige no observar el transcript completo, no retener contenido en el modelo de widget y no copiarlo a sesiones, eventos o logs.

## 7. Lifecycle y modos

- Crear controlador después de la apertura válida del runtime desde `session_start` o el lifecycle común ya existente; apertura fallida no crea una vista lista.
- Identificar cada apertura con una generación interna además de `sessionId`. Reabrir la misma sesión también invalida callbacks anteriores.
- Antes de publicar, comprobar generación y que el widget pertenece a la TUI activa. Un resultado tardío de consulta/adquisición no puede reaparecer en otra sesión.
- Al cambiar sesión, recargar o cerrar: sellar publicaciones, cancelar timers propios —incluido el reloj compartido de animación—, retirar widget, detener observadores y drenar lecturas admitidas antes de liberar el runtime.
- Limpieza idempotente, incluido `dispose()` del componente. Separar cierre de observación de aborto de conversación; nunca llamar `conversation.abort()` para limpiar la UI.
- La UI no prolonga la vida de la tool de inicio ni introduce esperas de finalización de jobs. Se conserva el cierre durable existente; no se promete un shutdown instantáneo.
- En print, JSON y RPC no registrar el componente ni iniciar consultas/timers de widget. Herramientas, ejecución y servicios siguen operativos sin esta proyección.

`ctx.hasUI` no basta para detectar terminal: en RPC puede ser true. Aunque RPC admite widgets de líneas mediante extension UI, exportar esta vista a un cliente remoto queda fuera de alcance. No se escribe contenido del widget en stdout headless.

## 8. Seguridad y autoridad

La proyección usa allowlist: ID, nombre de agente, estado público, timestamps necesarios, posición de cola, nombres e identidad interna de llamadas activas y señales técnicas de generación/compactación. Identificadores internos de conversación no salen del adaptador.

No mostrar ni persistir tarea, instrucciones/systemPrompt, definición completa de agente, rutas/cwd, respuestas, stdout, argumentos de herramientas, credenciales o errores libres. Los nombres también pueden ser sensibles; esta vista es para la sesión local confiable, no un canal sanitizado para terceros.

Antes de añadir estilo, eliminar secuencias de control de terminal, incluidos CSI/OSC, saltos de línea y controles capaces de reescribir pantalla o abrir enlaces. Usar las utilidades públicas existentes si cubren estos casos; truncar ancho por sí solo no sanitiza. La limpieza no elimina Unicode visible válido.

Widget y actividad no se guardan mediante `pi.appendEntry()` ni se envían mediante `pi.sendMessage()`/`sendUserMessage()`. La entrega no cambia la política actual de notificaciones terminales: cualquier revisión de contenido de esos avisos es otro alcance.

La vista no contiene acciones de aprobación, cancelación o retry. La revisión humana, consumo y promoción conservan sus fronteras existentes. Leer actividad no aprueba el resultado.

## 9. Superficie prevista de cambios

El plan deberá revisar como mínimo:

- `src/adapters/pi/register.ts`: propietario de UI, lifecycle de sesión y montaje sin romper comandos/tools/renderers actuales.
- `src/adapters/pi/display.ts`: reutilización de formatos aplicables; separar formato del widget si evita mezclar responsabilidades.
- `src/runtime/session.ts` y frontera durable de observación: solo B, sin exponer Harness a render ni alterar coordinación.
- `src/application/query.ts` y dominio: consumir contratos actuales; cualquier ajuste que resulte necesario deberá justificarse, no introducir nuevos estados por conveniencia de UI.
- Pruebas Pi existentes, mocks de contextos/UI y nuevas pruebas de selección, render, observación y cleanup.
- README y arquitectura: describir cada etapa únicamente después de implementarla y aceptarla.

No cambiar manifest, concurrencia, políticas de control, migraciones, ledger, outbox ni el plan aprobado de otra fase por esta spec. No se modifica el código durante su redacción.

## 10. Criterios de aceptación

| ID | Etapa | Gate verificable |
| --- | --- | --- |
| AC-W-01 | A | Aparece encima del editor con jobs no terminales; vacío retira contenido; no cambia foco ni componentes del host |
| AC-W-02 | A | Máximo 4 filas y 6 líneas; selección prioriza running/cancelling y conserva orden del servicio por conjunto |
| AC-W-03 | A | Cursor u omisiones indican «hay más»; encabezado nunca presenta un total calculado desde una sola página |
| AC-W-04 | A | Estados públicos preservados, provisioning como running; duración solo desde startedAt y posición ausente no se inventa |
| AC-W-05 | A | Refresco inicial/periódico sin solapamiento; consulta lenta/fallida conserva selección coherente y muestra frescura degradada |
| AC-W-06 | A | Anchos 20, 40 y 80 columnas, Unicode ancho/combinado y cambios de tema no desbordan ni conservan estilos antiguos |
| AC-W-07 | A | Nombres con CSI, OSC, controles y saltos no alteran terminal; no se exponen prompts, rutas o resultados centinela |
| AC-W-08 | A | Cierre, reload, cambio y reapertura del mismo sessionId dejan cero recursos propios y rechazan publicaciones tardías |
| AC-W-09 | A | Print/JSON/RPC no crean widget ni timers de esta UI; ejecución y consultas existentes conservan comportamiento |
| AC-W-10 | A | Lecturas del widget no consumen resultados ni modifican jobs, reviews, ledger o políticas de notificación |
| AC-W-11 | B | Snapshot de LiveDoc permite adjuntarse a mitad de ejecución con actividad correcta sin leer transcript ni cuerpo de resultados |
| AC-W-12 | B | Dos herramientas simultáneas, nombres repetidos y slots pending/running/done conservan llamadas correctas, sin contadores duplicados |
| AC-W-13 | B | Reintento, deferred, compactación bloqueante/no bloqueante y generación cumplen precedencia; nunca fabrican porcentaje |
| AC-W-14 | B | Falta/cierre de observador degrada solo actividad; recuperación usa snapshot y máximo un observador por job visible |
| AC-W-15 | B | Máximo 4 observadores; actividad y animación comparten el presupuesto de render de 250 ms; render no consulta SQLite ni recorre transcript |
| AC-W-16 | B | Estado durable terminal prevalece sobre actividad tardía; retirar UI/observadores no aborta ni cancela un job |
| AC-W-17 | Ambas | npm run check y npm test verdes, smoke de carga y verificación TUI humana documentados para cada etapa entregada |
| AC-W-18 | Ambas | Validación contra Pi instalado 1.1.0 y Pi Durable 1.0.1 documentada; límites registrados y sin inferir compatibilidad con Pi 1.0.4 |
| AC-W-19 | A | Frames de una columna en ciclo de 250 ms, un solo reloj para hasta 4 filas; ticks no aumentan consultas, observadores ni llamadas al modelo |
| AC-W-20 | A | Queued/paused, datos desactualizados y widget vacío no animan; running/cancelling frescos sí; detener/reanudar no altera estados ni layout |
| AC-W-21 | Ambas | PI_AGENTS_ANIMATION=0 mantiene información y refresco sin reloj continuo de animación; cleanup deja cero ticks tardíos y coalescing respeta 4 Hz |

Pruebas con reloj/temporizadores y UI controlados para selección, coalescing, lentitud, errores y generaciones; integración Durable real para observación, recuperación y cierre sin aborto. Incluir más de 4 activos, cola paginada e índice grande con resultados voluminosos. Comprobar operaciones y recursos retenidos, no tiempos de rendimiento frágiles ni solo snapshots visuales. Para animación, avanzar el reloj simulado, comprobar los cuatro frames y comparar contadores de consultas antes/después de varios ticks. Probar movimiento reducido, transición a datos desactualizados, reanudación, retirada y callbacks tardíos tras dispose/reload.

La aceptación humana usa Pi desde un cwd no relacionado, varios subagentes activos, una cola y un job completado; verifica que puede continuar escribiendo, consultar el resultado y cambiar/reabrir sesión sin mezclar filas. Debe registrar host/versiones y separar pruebas automatizadas de observación interactiva.

La tabla define los requisitos, no prueba por sí misma su cumplimiento. El [registro actualizado](../../WIDGET-ACCEPTANCE.md) identifica evidencia automatizada por criterio, aprobación humana recibida y escenarios interactivos aún no observados.

## 11. Evidencia, limitaciones y handoff

Fuentes primarias consultadas durante el análisis y la redacción:

- [Extensiones de Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) y [Terminal UI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/tui.md): widget, lifecycle, modos, tema y render.
- [Ejemplo widget-placement](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/widget-placement.ts) y [tipos de extensión](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts): placement, fábrica de componentes, dispose y modo TUI.
- [Pi Durable](https://github.com/earendil-works/pi/blob/main/packages/durable/README.md): observación estructural, documentos, eventos experimentales y cleanup.
- Instalación Pi `1.1.0` en `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`: docs anteriores, `docs/rpc-extension-ui.md`, `dist/core/extensions/types.d.ts` y `dist/modes/interactive/interactive-mode.js`.
- Pi Durable local `1.0.1`: `dist/index.d.ts`, `dist/harness/live.d.ts`, `dist/harness/events.d.ts` y contrato de `Session.watchDoc`.
- Código local: `src/adapters/pi/{register,display}.ts`, `src/application/{query,wait}.ts`, `src/domain/jobs.ts`, `src/runtime/{session,coordinator}.ts` y `src/infrastructure/durable/{execution,documents,repository}.ts`.

Los enlaces upstream usan main y pueden cambiar; no se identificó un commit upstream. Las rutas del host y node_modules son fuentes instaladas, no activos de evidencia versionados de este workspace.

El análisis ejecutó un self-check de imports para `watchEvents`, `Harness.open`, `truncateToWidth` y `visibleWidth` en Node `26.10.0`/Pi `1.1.0`. Una primera comprobación falló porque trató la fábrica `Harness` como clase; tras inspeccionar su export, la comprobación corregida pasó. La elección de `LiveDoc` se basa en exports y declaraciones públicas inspeccionados durante la redacción, no en una prueba TUI ni de observación real del widget.

El usuario aprobó expresamente la spec y el plan A+B y eligió ejecución Native el 2026-10-08. El 2026-10-09 autorizó continuar con B antes de la aceptación TUI de A y aplazar la decisión humana hasta revisar A+B conjuntamente; esta instrucción modifica la secuencia de aceptación, no el alcance técnico ni los criterios por etapa. La implementación continúa bajo la excepción limitada de roadmap ya registrada. Las APIs públicas de TUI y `LiveDoc.watchDoc()` se comprobaron contra Pi instalado 1.1.0 y Pi Durable 1.0.1 mediante inspección de contratos y smoke sin modelo; esto no certifica TUI interactiva ni compatibilidad con el host objetivo Pi 1.0.4. Mantener ese límite visible y no afirmar compatibilidad no probada. No se alteran otras fases ni se actualizan dependencias implícitamente.
