# Widget A+B — aprobación y evidencia

**Candidato actual: validación aceptada humanamente el 2026-10-09**, tras la guía
TUI local faux, suite 328/328 y check verdes y revisión independiente APTO.
Correcciones de `011-cierre-widget` sin publicar/integrar; fase 10 sigue bloqueada.

## Estado y alcance histórico — 2026-10-09

**Implementado, instalado y con visto bueno humano al widget A+B.** Base de código productivo: commit local `80d63d07bb9b61f9948eb0c1427af4f4883de3a9`, que integra `main` `29905ee`. Esta ampliación modifica documentación y pruebas, no código productivo.

La persona responsable confirmó «Ambos» al distinguir aprobación visual del widget y aprobación del resultado en TUI; después confirmó «listo» y «apruebo». Se registra esa decisión humana, no una evaluación visual hecha por el asistente. No equivale a revisión independiente del código, cierre de todos los ejercicios interactivos, merge, autorización de migraciones ni promoción de fase 10.

Para ampliar los casos especiales eligió explícitamente **«Solo automatizadas»**. La autorización condicional de un perfil temporal no se utiliza: no se crean perfiles ni se lanzan nuevos subagentes. Los casos con UI/timers controlados no se presentan como observaciones de una TUI real.

## Evidencia y entorno

- macOS arm64, Node `26.10.0`, Pi `1.1.0`, Pi Durable y Chord `1.0.1`; check descubre/alinea los peers del host. No se acredita Pi `1.0.4` ni otras versiones.
- Consolidación anterior: **316/316**, check verde y dry-run de paquete de 62 archivos; corresponde al código del commit `80d63d0`.
- Registro personal mediante `pi install` desde `.worktrees/widget-subagentes`: exit 0; `pi list` resolvió una única referencia a esa carpeta, conservando los demás paquetes.
- Prueba real: `parent-review-reviewer`, job `psa_1791569755156_20f095d5c92438`, terminó en `completed`. La API negó el cuerpo mientras exigía revisión humana; tras la confirmación TUI final permitió su lectura con `consume:false`. Fue una lectura de documentación, **no una revisión del widget**. No se copia el contenido del resultado.
- Ampliación automatizada: **60/60** pruebas focales y **321/321** de suite completa, sin fallos, cancelaciones, omisiones ni TODO; `npm run check` exit 0.
- Smoke CLI aislado, con directorios temporales de agente/estado, offline y sin MCP: exit 0, sin errores de carga reportados. Su salida fue `No models available`; no hubo modelo ni conversación de prueba en ese smoke. No acredita montaje visual.

Los logs completos están en evidencia local ignorada: `.superpowers/widget-consolidation-20261009T173147Z/automated-evidence-6i82wfou/` (`special-cases.log`, `special-cases-green.log`, `suite.log`, `check.log`, `smoke.stdout`, `smoke.stderr`). Son evidencia privada local, no recursos distribuidos del paquete. El primer intento del nuevo test de ancho falló por exigir el texto completo de estado a 20 columnas; se corrigió la expectativa de truncado y se repitieron todos los gates. No se presenta ese fallo de la prueba como un defecto corregido en producción ni como TDD de una funcionalidad nueva.

## Revalidación de cierre — rama `011-cierre-widget`

Continuación desde la base local `94288cc`, que ya incorpora PR #12. El visto bueno
humano anterior se conserva. El registro siguiente describe primero la revalidación
previa a la aceptación; la confirmación humana del candidato se registra más abajo.

Se corrigió una brecha real de AC-W-05: antes del primer snapshot exitoso, fallo o
lectura >5 s dejaban el widget oculto. Ahora muestra «Estado no disponible», acotado
al ancho y sin detalles privados; éxito vacío lo retira. Un fallo posterior a un
snapshot vacío válido no crea un widget de error. Tres regresiones, RED previo con
dos fallos esperados, widget 23/23, ampliación focalizada **63/63** y suite completa
**324/324** verdes; `npm run check` exit 0. Smoke CLI offline desde cwd ajeno exit 0
sin errores de carga reportados: `No models available`, no modelo/conversación ni
montaje visual. Dry-run de paquete: 57 archivos, sin publicar. Se completaron mocks `setWidget` de adaptadores; los fallos
intermedios se conservan en logs. No se modificó RPC, storage ni dependencias.

Logs: `.cache/pi-agents/verification/`; comandos/estados y archivos preservados en
[RECONCILIATION](../specs/RECONCILIATION.md). La primera revisión independiente devolvió NO APTO; sus hallazgos se corrigieron
y la segunda revisión CLI es APTO para solicitar aceptación humana, sin findings nuevos. La aceptación posterior de la guía TUI se registra abajo. Ninguna prueba automatizada observa foco/editor
real ni certifica Pi 1.0.4. La instalación personal anterior no carga automáticamente
esta corrección desde el nuevo worktree.

### Correcciones tras revisión y declaración humana

Revisión CLI independiente autorizada, solo lectura, `openai-codex/gpt-6.1-sol`
high: NO APTO por adquisición lenta de B que ocultaba A y por IDs truncados sin
remisión al listado. Informe inicial preservado en logs. Cuatro regresiones RED;
se publica el snapshot antes de observar, adquisiciones/cierres pendientes también
reservan slots (máximo cuatro), y cierre drena/descarta actividad tardía. ID+estado
que no caben usan resumen `/subagents list` con tema y ancho. Gates posteriores:
**67/67** focalizadas, **328/328** suite y check verdes. Segunda revisión CLI: **APTO
para solicitar aceptación humana**, sin findings nuevos, exit 0. Informe
`widget-independent-rereview.md`; el revisor no ejecutó tests. Smoke/pack de fixes
repetidos: exit 0 sin modelo/TUI y dry-run de 57 archivos; no publicación.

La persona declara haber probado **el widget A+B anterior**, bloque «Activos,
cola y editor» (cwd ajeno, varios activos/cola, retiro vacío, foco/escritura).
Es declaración humana, no observación del asistente; sin ruta/versión exactas.
No corresponde al candidato nuevo y no añade evidencia de los demás bloques TUI.
No se infiere aceptación completa ni se revoca el visto bueno histórico.

### Sesión TUI aislada del candidato actual — preparación y aceptación

Nuevo permiso humano: perfil **desechable faux**, solo en un directorio temporal;
no reutilizar `parent-review-reviewer` ni modificar instalación/settings personales.
El lanzador local ignorado `.cache/pi-agents/verification/widget-tui.sh` carga el
`index.ts` absoluto de `011-cierre-widget` desde un cwd ajeno. Aísla HOME, agentes,
estado y sesiones; limpia el entorno heredado y elimina sus datos de prueba al
salir normalmente. No copia credenciales ni carga MCP/recursos personales. Usa
`faux/faux-1`, sin solicitudes a proveedores remotos; offline/cwd no son sandbox.
No ejecutar `/login`, `/share`, `/bug` ni comandos de shell ajenos al ejercicio.

**F**, comprobación local previa: `widget-tui-selfcheck.mjs` valida perfil,
bridge nativo ModelRuntime, Harness/SQLite, dos `bash` simultáneas con callIds
distintos, transición 2→1, finalización y fallo local seguido de retry por servicio
con actor de prueba `human`. No es aceptación humana ni retry automático del
proveedor. Smoke del lanzador `--smoke`: exit 0, respuesta faux y stderr vacío;
esta vez sí selecciona modelo local. Sigue siendo print, no observación TUI.
Logs `widget-tui-selfcheck-*` y `widget-tui-smoke.*` conservan también fallos de la
comprobación inicial: omitía `watch.initial` y confundía la proyección de wait con
`JobView`. Se corrigió el comprobador, no producto. Estos fixtures privados no
se distribuyen ni constituyen nuevos comandos del paquete.

Desde la raíz del checkout principal:

```sh
bash .worktrees/cierre-widget-011/.cache/pi-agents/verification/widget-tui.sh
```

1. Registrar ruta del candidato, Pi/Node y SHA-256 impresos al iniciar; usar
   `/session` y `/name Widget011-A`. Widget actual:
   `139a42f01edfc72be7c83bf832060cd5c1ba73086f1b6aa4fca811c96c9d5c1d`.
2. Ejecutar `/subagents widget-check "largo A"`, luego `"largo B"` y `"rapido C"`
   con el mismo prefijo de comando. Concurrencia 2: dos activos y uno en cola;
   cada largo ejecuta exclusivamente `/bin/sleep 60` y `/bin/sleep 90`.
   A ancho suficiente, comprobar `herramientas: bash, bash`, después una sola
   `bash`, estados/duración y retiro al acabar. Es ejecución local real de tools,
   respuesta del modelo scripted; no herramientas remotas. Escribir sin enviar
   para comprobar foco, y consultar `/subagents list` como contraste.
3. Mientras haya filas, variar ancho (80/40/20) y tema desde `/settings`;
   si ID+estado no caben debe remitir a `/subagents list`, sin identidad ambigua.
   No deben aparecer tareas, argumentos, resultados ni rutas dentro del widget.
4. Crear `/subagents widget-check "WIDGET_FALLO rapido"`; comprobar `failed` con
   `/subagents list` y ejecutar `/subagents retry <id>` **antes de `/reload`**.
   Debe crear otro job y acabar `completed`; no confundirlo con espera/retry del
   proveedor. `/reload` reinicia la memoria del proveedor de prueba.
5. Comprobar `/reload`, `/new` y reapertura de `Widget011-A` mediante `/resume`,
   incluyendo un cambio con actividad pendiente. No deben reaparecer filas de
   otra sesión ni quedarse actividad/ticks retirados. Cleanup puede esperar a
   herramientas pendientes; no forzar liberación de lease ni matar el proceso.
6. Salir normalmente y repetir con `PI_AGENTS_ANIMATION=0` delante del lanzador:
   spinner inmóvil, datos/duración/refresco aún vigentes. Los datos de la primera
   ejecución ya fueron eliminados; la reapertura se prueba dentro de ella.

Registrar por bloque **observado / falló / no observado**, versión/ruta/hash y
motivo. El 2026-10-09, tras recibir esta guía, la persona confirmó literalmente:
**«listo, todos los escenerios pasaron correctamente»**. Se registra aceptación de
los bloques guiados 1–6 del candidato, no observación visual hecha por el asistente.
No envió capturas/logs ni medición independiente de hash/versiones: la identificación
se vincula al lanzador suministrado y al hash de referencia arriba.

Con gates técnicos previos verdes y revisión APTO, **validación de 011 cerrada**;
T005/T015 se marcan por esta confirmación, no por los tests. La revisión de 003
ya autorizada puede iniciar; no hereda aceptación del widget. No se indujeron
compactación de hijo, retry automático/deferred, fallo de lectura ni adquisición
lenta en terminal: conservan cobertura automatizada y límites, sin sustituirlos
por `/compact` del padre ni atribuirlos a «todos los escenarios». Registro literal
local `widget-tui-acceptance.md`. No autoriza entrega Git ni promueve fase 10.

## Matriz de criterios AC-W

**A**: automatizado con controlador/UI/reloj controlados. **D**: Harness/SQLite reales con LiveDoc sintético o proveedor faux, sin proveedor remoto. **H**: confirmación humana o ejecución real anterior, con el alcance indicado. Una cobertura A/D no acredita observación H de cada escenario.

Referencias de pruebas del repositorio (no incluidas en el tarball):

- **W**: `tests/pi-subagentes-widget.test.mjs`.
- **O**: `tests/session-widget-observation.test.mjs`.
- **I**: `tests/pi-adapters.test.mjs`.
- **L**: `tests/pi-lifecycle.test.mjs`.
- **R**: `tests/session-runtime.test.mjs`.
- **X**: `tests/widget-large-index.test.mjs`.
- **F**: comprobador privado de la sesión faux descrito arriba, separado de la suite.

| Criterio | Evidencia ejecutada | Límite de la evidencia |
| --- | --- | --- |
| AC-W-01 | A/I: montaje `aboveEditor`, retiro tras éxito vacío; W: sin handlers de teclado. H: visto bueno visual histórico y declaración actual de cwd ajeno/foco/editor/retirada sobre widget previo. H actual: guía del candidato local pasada, cwd/editor/retirada declarados. | Declaración humana sobre el lanzador suministrado; sin captura ni hash/versiones independientes del terminal. |
| AC-W-02 | A/W: activos antes de cola, 4 filas/6 líneas; X: 2 páginas de 5. H: persona declara varios activos/cola en widget previo. H actual: activos y cola locales declarados sin fallos. | Proveedor faux con tools locales; no benchmark ni censo transaccional. |
| AC-W-03 | A/W y X: cursor/omisión muestra continuidad y encabezado de visibles, sin seguir cursor. | No listado global ni censo transaccional. |
| AC-W-04 | A/W: estados, duración desde `startedAt`, cola/pausa y posición ausente; suite de query: proyección pública. | La pausa activa sigue no soportada. |
| AC-W-05 | A/W: error en primera/segunda consulta tras vista válida, selección previa, lentitud >5 s y no solapamiento. Revalidación: aviso antes del primer snapshot por error/lentitud, recuperación vacía y no aviso tras éxito vacío. | No fallo inyectado ni observación de indisponibilidad inicial en TUI real. |
| AC-W-06 | A/W: 20/40/80, Unicode, tema vigente y truncado; nueva colisión de IDs del mismo milisegundo remite al listado si ID+estado no caben. H actual: anchos 80/40/20 y cambio de tema de la guía declarados sin fallos. | Sin medición instrumental del terminal ni nueva ejecución remota. |
| AC-W-07 | A/W: CSI/OSC/controles eliminados y sin tarea/cwd; D/O: centinelas de args, output, detalles, diagnóstico y generación no proyectados. | LiveDoc se materializa dentro del proceso antes de proyectarse. |
| AC-W-08 | A/W: lectura/adquisición/callback tardíos, nueva instancia bajo igual clave y cero timers tras cerrar; L: generación nueva incluso con mismo sessionId; D/O y R: drenaje/lease. H actual: reload, cambio y reapertura de la guía declarados sin fallos. | Declaración sobre ejercicios guiados, no medición de todos los callbacks/timers internos. |
| AC-W-09 | A/I: TUI con UI frente a RPC con hasUI, print, JSON y TUI sin UI; solo TUI válida monta. H actual: terminal local del candidato según declaración de la persona. | No nuevo cliente remoto ni acreditación interactiva de modos no TUI. |
| AC-W-10 | A/W: jobs congelados sin mutación; X: solo servicios de consulta; H: lectura explícita `consume:false`. | No aceptación de otras políticas ni aprobación por observar. |
| AC-W-11 | D/O: snapshot inicial de LiveDoc y reemplazos, sin cuerpo; A/W: snapshot al recuperar observación. | Snapshot sintético, no replay de una generación remota. |
| AC-W-12 | D/O: dos slots running con igual nombre y distinto callId, pending/done excluidos; A/W: reemplazos y `+N`. D/F: dos bash locales reales, callIds distintos y transición 2→1 desde LiveDoc. H actual: dos bash locales y transición 2→1 de la guía declaradas sin fallos. | F no observa terminal; H sí declara la guía local pasada. No tools de proveedor remoto. |
| AC-W-13 | A/W: retry, deferred, compactación bloqueante/de fondo, generación y precedencia, sin porcentaje. D/O: metadatos allowlisted. | No se indujo retry/deferred/compactación en un proveedor real. |
| AC-W-14 | A/W: ausencia/fin de watch y recuperación; nueva adquisición lenta no bloquea snapshot, otros observadores ni consultas. D/O: cierre idempotente y eliminación de handles. H actual: actividad B local y lifecycle de la guía declarados sin fallos. | No desconexión remota ni adquisición lenta inducida en terminal. |
| AC-W-15 | A/W: máximo cuatro slots incluyendo adquisiciones/cierres lentos o fallidos, drenaje final, coalescing 250 ms y spinner sin consultas. X: renders sin nuevas materializaciones. | Sin garantía de memoria constante del SDK ni coste constante del índice; fallo de cierre retiene reserva hasta cleanup. |
| AC-W-16 | A/W: terminal durable gana frente a actividad tardía y cierra watch; D/O y R: retirada de observación sin esperar al proveedor, lease hasta cierre SDK real. | No se sintetiza cancelación durable. |
| AC-W-17 | Histórico: 60/60 focales, 321/321 suite; H: visto bueno/job. Fixes: 67/67 focales, 328/328 suite, check, smoke y pack dry-run verdes; segunda revisión CLI APTO sin findings nuevos. H actual: aceptación de los escenarios guiados del candidato el 2026-10-09. | Cierra validación del candidato con límites documentados; no autoriza publicación/integración ni acredita escenarios no inducidos. |
| AC-W-18 | Check con host Pi 1.1.0; D/O y R contra Durable 1.0.1; límites explícitos. | Sin promesa de Pi 1.0.4 u otros hosts. |
| AC-W-19 | A/W: frames `| / - \\`, reloj único y ticks sin nuevas consultas/watches. H actual: animación normal de la guía declarada sin fallos. | La prueba no evalúa frecuencia física del terminal. |
| AC-W-20 | A/W: queued/paused estáticos, parada por datos desactualizados y reanudación tras éxito, retiro vacío. | No nuevo fallo de almacenamiento real. |
| AC-W-21 | A/W: `PI_AGENTS_ANIMATION=0` conserva información/refresco; cierre deja cero ticks tardíos, presupuesto compartido. H actual: movimiento reducido de la guía declarado sin fallos. | Declaración humana local, no medición instrumental de frecuencia/coste. |

## Índice grande: operaciones, no promesa de rendimiento

X crea una base SQLite temporal de esquema 5 con **2.000 summaries y jobs**, incluidos 10 running, 10 queued y terminales más recientes. Guarda dos resultados de **más de 1 MiB** cada uno y reabre el almacenamiento antes de la consulta. Usa QueryService/repository/controlador reales, sin Harness de modelo ni perfil de usuario.

Se observaron **4.000 visitas a summaries en los dos listados** de QueryService, **10 jobs expandidos** (5 por conjunto), continuidad en ambas páginas y **0 lecturas de la familia de resultados**. El widget mostró 4 activos; 20 renders adicionales no iniciaron más consultas ni expansiones. Los contadores no son un inventario de toda operación interna del SDK/posición de cola y no deben interpretarse como dos I/O totales.

Esto demuestra que la proyección evita los cuerpos voluminosos, **no que el listado tenga coste constante**: sigue recorriendo el índice y ordenando los candidatos. No es un benchmark de carga real ni justifica añadir cache/índice agregado en este alcance.

## Reproducción automatizada

Desde el worktree que contiene esta implementación:

```sh
node --test tests/pi-subagentes-widget.test.mjs tests/session-widget-observation.test.mjs tests/widget-large-index.test.mjs tests/pi-adapters.test.mjs tests/pi-lifecycle.test.mjs tests/session-runtime.test.mjs
npm test
npm run check
```

El smoke aislado se ejecuta con un directorio temporal `PI_CODING_AGENT_DIR`, otro `PI_AGENTS_STATE_DIR`, `PI_OFFLINE=1`, `--no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve --no-session`, el `--extension` absoluto de este worktree y `--list-models __pi_agents_smoke_no_match__`. No copiar rutas privadas de los logs ni usar una base de sesión real como fixture.

## Pendientes y exclusiones

- Revisión independiente inicial NO APTO, hallazgos corregidos, segunda revisión APTO y aceptación humana posterior de la guía del candidato: validación de 011 cerrada. PR #12 ya está fusionada en la base `94288cc`; las correcciones actuales no están publicadas ni integradas. Cualquier stage/commit/push/merge/publicación requiere autorización separada. La solicitud histórica «crea PR» de la consolidación anterior no se traslada a este worktree.
- La declaración sobre widget previo se conserva; ahora también se registra la guía local del candidato pasada (tools/lifecycle, anchos/tema y movimiento reducido). No se atribuye observación de compactación de hijo, retry automático/deferred o fallos no inducidos en terminal. **No se retira el visto bueno humano ya recibido** ni se sustituye por tests.
- En la consolidación histórica no se ejecutaron nuevas migraciones de datos reales, proveedores remotos ni tareas de subagentes; tampoco se cambiaron runtime, RPC/outbox, esquema, dependencias, instalación/settings o perfiles. La continuación actual solo corrige el widget y sus mocks/pruebas; no altera storage, RPC ni la instalación personal.
- SDK 1.0.1 puede retener recursos/lease si el proveedor no cierra; no se libera por timeout. Los límites de seguridad cooperativa y no-sandbox se conservan.
- La fase 10 completa sigue bloqueada por 01–09; esta evidencia solo corresponde a la excepción del widget A+B.
