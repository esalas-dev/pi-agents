# Diseño: runner visible para aceptación TUI de fase 03

## Estado y autoridad

**Diseño conversacional aprobado por el usuario el 2026-10-08.** Este documento captura el diseño del runner y habilita su revisión; no autoriza todavía un plan de implementación. El runner será auxiliar de pruebas, no código de producto. No cambia los criterios de aceptación: la automatización no sustituye decisiones TUI humanas ni revisión independiente.

## 1. Intención y alcance

El usuario quiere ejecutar automáticamente los gates TUI de fase 03 que quedaron pendientes o inconclusos, viendo en Pi cada escenario y sus resultados, y conservando autoridad sobre los diálogos reales. El objetivo es reducir la secuencia manual y producir evidencia verificable, no simular aprobación humana.

Incluye:

- Runner temporal visible dentro de una sesión Pi TUI real.
- Uso del cliente RPC público (`rpc.ts`) y del bus `pi.events` del mismo proceso.
- Reejecución solo de los gates TUI pendientes, parciales o inconclusos.
- Pausas en checkpoints de aprobación humana, con instrucciones explícitas para continuar.
- Registro por escenario de resultado, IDs, respuestas y estados observados.
- Ejecución de `npm run check` y `npm test` como gates automáticos separados.

Excluye:

- Cambios a `src/`, al paquete runtime, a settings globales o a bases reales.
- Conducir la TUI mediante keystrokes sintéticos o inferir decisiones humanas.
- Publicar, fusionar o aprobar revisión independiente.
- Afirmar convivencia real con upstream.

## 2. Alternativas consideradas

| Enfoque | Ventajas | Límites | Decisión |
|---|---|---|---|
| Extensión temporal in-process | TUI real, usa el bus y cliente públicos, diálogos nativos; sin parser de pantalla ni dependencia nueva | Comparte el proceso de Pi; debe restringirse a fixture y detenerse en resultados inesperados | Elegido |
| Driver externo PTY | Recorre el CLI y el terminal desde fuera | Simulación de teclado y lectura de pantalla frágiles ante terminal, tamaño, tema y cambios de UI | Rechazado |
| RPC headless | Interfaz estructurada y fácil de automatizar | No presenta la TUI real; no satisface aprobación TUI humana | Rechazado |

## 3. Arquitectura propuesta

El generador existente `prepare-tui-fixtures.mjs` producirá un módulo temporal `tui-acceptance-runner.mjs` en la fixture fuera del repositorio. Se cargará explícitamente junto con `index.ts` al iniciar Pi interactivo, sin activar extensiones descubiertas. El runner importará `createRpcClient` desde el `rpc.ts` público y emitirá solicitudes por `pi.events`; no importará servicios ni repositorios internos.

La ejecución usará un `sessionId` nuevo y rutas separadas de sesión y estado bajo el directorio temporal de la fixture. El runner hará ping antes de operar y comprobará que no haya jobs activos previos. Si el directorio deja de ser temporal, el ping falla, una precondición no se cumple o aparece un resultado inesperado, se detendrá sin continuar a la siguiente mutación.

El runner expondrá comandos TUI por escenario, mostrará progreso y evidencia mediante APIs de UI de Pi, y conservará el estado mínimo para reanudar los puntos que requieren una acción humana fuera del handler actual. No creará una segunda instancia de renderer ni automatizará el teclado.

## 4. Escenarios pendientes

El runner debe cubrir los gates que el registro de T9 dejó pendientes, parciales o inconclusos al momento de aprobar este diseño:

1. **Cancelación en cola sin confirmación activa**: encolar un candidato detrás de un hold activo, cancelarlo y confirmar `cancelled`; registrar explícitamente si apareció un diálogo.
2. **Cancelación activa aceptada**: iniciar el control cuando el hold esté activo, dejar que aparezca el diálogo nativo, esperar la decisión humana y verificar el estado terminal. La corrida previa terminó `completed` cerca del final natural de `sleep 300`, por lo que la repetición debe emitir el control inmediatamente al confirmar `running`.
3. **Cancelación activa rechazada**: mostrar el diálogo real, el usuario lo rechaza y el runner verifica que no se registró una cancelación; después solicita una confirmación separada para limpiar el hold.
4. **Deadline y respuesta tardía**: mantener el diálogo de cancelación sin responder durante más de 31 s y registrar la respuesta observada. Si la TUI aún permite responder, aceptar después y comprobar que no se persiste una cancelación tardía; si el diálogo ya se cerró, registrar esa limitación y verificar el estado. Limpiar el hold con una nueva solicitud y confirmación.
5. **Carrera terminal**: iniciar el agente corto `tui-race`, solicitar cancelación mientras siga activo, esperar a que termine y responder el diálogo; comprobar que el estado terminal no se sobrescribe. Si no se alcanza el estado activo antes de terminar, registrar el caso como inconcluso, no como pasado.
6. **Pausa activa no soportada**: con un hold confirmado activo, llamar `pause`, exigir `PAUSE_ACTIVE_UNSUPPORTED` y luego limpiar el hold mediante el flujo humano normal.
7. **Respuesta inicial de consume**: crear un resultado de prueba, pausar para que el usuario ejecute `/subagents approve <jobId>`, reanudar el runner, consumir con un `requestId` nuevo, reconciliar con `status` y repetir exactamente la mutación para verificar idempotencia. Un timeout con commit observado se registrará como anomalía, no como éxito de respuesta.

Los escenarios serán independientes y usarán IDs únicos. El runner no continuará automáticamente tras un fallo, timeout inesperado o respuesta ambigua. La limpieza de jobs activos es parte del escenario y requiere la interacción TUI correspondiente; el usuario no debe cerrar Pi mientras quede un job activo.

## 5. Autoridad y pausas humanas

Los diálogos de cancelación activa y controles de limpieza son los diálogos reales del producto. El runner no los responde. El usuario verá el caso y su objetivo antes de emitir una mutación, y decidirá aceptar o rechazar en la TUI.

La aprobación/rechazo de revisión de resultados permanece en el comando humano `/subagents approve` o `/subagents reject`. Para el escenario de consume, el runner terminará una etapa mostrando el `jobId` y el comando que debe ejecutar el usuario; un comando de continuación revalidará el estado antes de consumir. No se convertirá una confirmación del runner en actor humano ni se permitirá aprobación por RPC.

## 6. Seguridad, costos y datos

- Fixtures, sesiones, SQLite, outputs de los jobs y locks viven bajo un directorio temporal aislado; el runner usa un `sessionId` nuevo y aborta ante precondiciones de aislamiento incumplidas. El registro de aceptación se limita al artefacto local ignorado de T9.
- No se leen ni migran bases globales/reales. No se cambian `~/.pi/agent/settings.json` ni `.pi/settings.json` del checkout.
- Los jobs usan el modelo/proveedor configurado por Pi y pueden generar costo. El agente `tui-hold` ejecuta solo el `sleep` acotado definido en fixture; el usuario debe detener la prueba ante cualquier herramienta/acción inesperada.
- El hold configurado es de hasta 300 s. El runner limpia jobs antes del cierre; la limitación conocida de Pi Durable 1.0.1 puede hacer que el shutdown espere a `TaskScheduler.join()`.
- No se agregan dependencias.

## 7. Evidencia y criterio de salida

El runner escribirá evidencia append-only de cada escenario al registro T9 bajo `.superpowers/sdd/.../task-9-tui-acceptance.md` (artefacto local ignorado por Git). Cada fila será `pasó`, `falló`, `inconcluso` u `omitido`, con request IDs, job IDs, salida RPC y estado final observados. No infiere pasos a partir del silencio de una notificación.

`npm run check` y `npm test` se ejecutan por separado y sus resultados se registran como cobertura automática. Los resultados del runner, aun con todos los escenarios aprobados por el usuario, prueban solo la aceptación TUI de esta fixture. **La fase sigue en validación hasta que exista además una revisión independiente documentada.** No hay publicación ni merge dentro del alcance.

## 8. Verificación de este diseño

Antes de planificar implementación se comprobará que no haya criterios que confundan los resultados automáticos con aceptación humana, que todas las mutaciones tengan un checkpoint humano, que cada job activo tenga ruta de limpieza, y que los paths de estado y sesión sean explícitamente temporales. El usuario revisará este documento; solo su aprobación habilita el plan de implementación.
