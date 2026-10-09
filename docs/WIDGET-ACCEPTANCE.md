# Widget A+B — aprobación y evidencia

## Estado y alcance — 2026-10-09

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

## Matriz de criterios AC-W

**A**: automatizado con controlador/UI/reloj controlados. **D**: Harness/SQLite reales con LiveDoc sintético o proveedor faux, sin proveedor remoto. **H**: confirmación humana o ejecución real anterior, con el alcance indicado. Una cobertura A/D no acredita observación H de cada escenario.

Referencias de pruebas del repositorio (no incluidas en el tarball):

- **W**: `tests/pi-subagentes-widget.test.mjs`.
- **O**: `tests/session-widget-observation.test.mjs`.
- **I**: `tests/pi-adapters.test.mjs`.
- **L**: `tests/pi-lifecycle.test.mjs`.
- **R**: `tests/session-runtime.test.mjs`.
- **X**: `tests/widget-large-index.test.mjs`.

| Criterio | Evidencia ejecutada | Límite de la evidencia |
| --- | --- | --- |
| AC-W-01 | A/I: montaje `aboveEditor`, retiro tras éxito vacío; W: componente sin handlers de teclado. H: visto bueno visual. | Foco/escritura y cwd ajeno no se observaron separadamente. |
| AC-W-02 | A/W: selección activa antes de cola, 4 filas/6 líneas; X: 2 páginas de 5 con 4 filas visibles. | No nueva concurrencia de jobs remotos. |
| AC-W-03 | A/W y X: cursor/omisión muestra continuidad y encabezado de visibles, sin seguir cursor. | No listado global ni censo transaccional. |
| AC-W-04 | A/W: estados, duración desde `startedAt`, cola/pausa y posición ausente; suite de query: proyección pública. | La pausa activa sigue no soportada. |
| AC-W-05 | A/W: error en primera/segunda consulta tras vista válida, selección previa, lentitud >5 s y no solapamiento. | No fallo inyectado en la TUI del usuario ni comprobación del mensaje inicial sin vista previa. |
| AC-W-06 | A/W: 20/40/80 columnas, Unicode ancho/combinado, cambio de tema sobre la misma instancia y truncado. | Cambios de terminal/tema reales no observados en esta ampliación. |
| AC-W-07 | A/W: CSI/OSC/controles eliminados y sin tarea/cwd; D/O: centinelas de args, output, detalles, diagnóstico y generación no proyectados. | LiveDoc se materializa dentro del proceso antes de proyectarse. |
| AC-W-08 | A/W: lectura/adquisición/callback tardíos, nueva instancia bajo igual clave y cero timers tras cerrar; L: generación nueva incluso con mismo sessionId; D/O y R: drenaje/lease. | No se ejecutó `/reload` ni cambio/reapertura TUI en esta ampliación. |
| AC-W-09 | A/I: TUI con UI frente a RPC con hasUI, print, JSON y TUI sin UI; solo TUI válida monta. | No nuevo cliente remoto ni terminal real. |
| AC-W-10 | A/W: jobs congelados sin mutación; X: solo servicios de consulta; H: lectura explícita `consume:false`. | No aceptación de otras políticas ni aprobación por observar. |
| AC-W-11 | D/O: snapshot inicial de LiveDoc y reemplazos, sin cuerpo; A/W: snapshot al recuperar observación. | Snapshot sintético, no replay de una generación remota. |
| AC-W-12 | D/O: dos slots running con igual nombre y distinto callId, pending/done excluidos; A/W: reemplazos y `+N`. | No se observaron dos tools remotas simultáneas en la TUI. |
| AC-W-13 | A/W: retry, deferred, compactación bloqueante/de fondo, generación y precedencia, sin porcentaje. D/O: metadatos allowlisted. | No se indujo retry/deferred/compactación en un proveedor real. |
| AC-W-14 | A/W: falta/terminación de watch degrada solo actividad y recupera al siguiente ciclo; D/O: cierre idempotente y eliminación de handles terminados. | No desconexión real del proveedor. |
| AC-W-15 | A/W: 4 watches, coalescing de 250 ms, spinner sin lecturas/watches adicionales; X: renders repetidos sin nuevas consultas/materializaciones. | No garantía de memoria constante del SDK ni coste constante del índice. |
| AC-W-16 | A/W: terminal durable gana frente a actividad tardía y cierra watch; D/O y R: retirada de observación sin esperar al proveedor, lease hasta cierre SDK real. | No se sintetiza cancelación durable. |
| AC-W-17 | 60/60 focales, 321/321 suite, check y smoke aislado verdes; H: visto bueno y job real registrado arriba. | Matriz interactiva completa e independiente no ejecutada. |
| AC-W-18 | Check con host Pi 1.1.0; D/O y R contra Durable 1.0.1; límites explícitos. | Sin promesa de Pi 1.0.4 u otros hosts. |
| AC-W-19 | A/W: frames `| / - \\`, reloj único y ticks sin nuevas consultas/watches. | La prueba no evalúa frecuencia física del terminal. |
| AC-W-20 | A/W: queued/paused estáticos, parada por datos desactualizados y reanudación tras éxito, retiro vacío. | No nuevo fallo de almacenamiento real. |
| AC-W-21 | A/W: `PI_AGENTS_ANIMATION=0` conserva información/refresco; cierre deja cero ticks tardíos, presupuesto compartido. | Movimiento reducido no ejercitado visualmente aquí. |

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

- Revisión independiente del código del widget y merge, con autorización separada. Después del cierre de la ampliación automatizada, la persona responsable solicitó «crea PR»: autoriza commit de documentación/pruebas y publicación normal de esta rama contra `main`, no merge ni promoción de fase.
- Evidencia TUI específica aún no registrada: cwd no relacionado, múltiples activos/cola, dos tools simultáneas, foco/escritura, cambios de sesión/reload/reapertura, retry/compactación cuando reproducibles, temas/anchos y movimiento reducido. **No se retira el visto bueno humano ya recibido**; faltan esas observaciones, no una aprobación inventada por tests.
- No se ejecutan nuevas migraciones de datos reales, proveedores remotos ni tareas de subagentes. No se cambian runtime, RPC/outbox, esquema, dependencias, instalación/settings o perfiles.
- SDK 1.0.1 puede retener recursos/lease si el proveedor no cierra; no se libera por timeout. Los límites de seguridad cooperativa y no-sandbox se conservan.
- La fase 10 completa sigue bloqueada por 01–09; esta evidencia solo corresponde a la excepción del widget A+B.
