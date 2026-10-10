# Indicaciones para validar hallazgos de la fase 03

## Propósito

Esta guía define cómo revisar de forma independiente los hallazgos N1–N6 de
`003-eventos-rpc` después de sus correcciones. La revisión debe determinar si cada
hallazgo está resuelto en el código actual y si la fase puede solicitar cierre técnico.

No convierte una aceptación TUI, una suite verde o un proveedor faux en revisión
independiente.

## Alcance y aislamiento

- Worktree: `.worktrees/cierre-widget-011`.
- Rama: `011-cierre-widget`.
- Revisar el diff completo de 003 y sus callers, no solo los archivos modificados.
- Leer primero `AGENTS.md`, la constitución, `specs/README.md`, `specs/MIGRATION.md`,
  `specs/ROADMAP.md` y `specs/003-eventos-rpc/{spec,plan,tasks}.md`.
- Usar únicamente lectura y búsqueda: `read`, `rg/grep`, `find` y `ls`.
- No ejecutar tests, migraciones, smoke, proveedores, TUI ni comandos con efectos.
- No escribir archivos, crear perfiles, usar extensiones/MCP, leer credenciales,
  settings privados o sesiones SQLite reales.
- No hacer stage, commit, push, merge, publicación ni promoción de fases posteriores.

## Hallazgos que deben validarse

| Hallazgo | Pregunta de validación | Evidencia mínima esperada |
|---|---|---|
| **N1 — cancelación queued/paused** | ¿La cancelación de un job no activo evita consentimiento de cancelación activa, pero conserva la protección contra la carrera hacia un estado activo? | Recorrido de `repository.ts`, `control.ts` y callers RPC/TUI; comprobar replay, conflicto y carrera sin intención indebida. |
| **N2 — despertar del coordinador** | ¿`resume` y los estados `cancelling` despiertan el coordinador cuando corresponde? | Caller de `SessionRuntime.control`, `coordinator.wake()` y transición durable; verificar que no se despierta una generación retirada. |
| **N3 — DTO de provisioning** | ¿El estado interno `provisioning` se proyecta públicamente como `running` sin filtrar campos internos? | `publicControlStatus`, serializador RPC y consumidores de status/list/wait; revisar `previousStatus` y tipos públicos. |
| **N4 — generaciones retiradas** | ¿Una generación retirada descarta envíos/publicaciones tardías y `seal` limpia timers y aborta intentos pendientes? | `rpc.ts`, `generation.ts`, lifecycle y register; seguir correlación, cierre, timeout y respuesta tardía. |
| **N5 — aborto durante adquisición de watch** | ¿Abortar mientras se adquiere `watchDoc` detiene el watch y devuelve el resultado de espera correcto sin dejar trabajo pendiente? | `wait.ts`, caller de sesión y cleanup del watch; comprobar que abortar la observación no cancela el job durable. |
| **N6 — fixture v4 válida** | ¿La migración 4→5 conserva datos válidos y permite recuperación/replay, sin fabricar eventos históricos? | `tests/helpers/v4.mjs`, `tests/migration-v4.test.mjs`, `schema4-source.ts` y runtime; comprobar IDs Durable reales, ledger canónico, replay idempotente, reapertura y outbox vacío. |

## Método de revisión

1. **Confirmar la entrada.** Identificar el caller público y la transición durable que
   alcanza el caso; no aceptar una conclusión basada solo en el nombre de un test.
2. **Seguir la frontera de autoridad.** Comprobar actor, propietario, sesión, generación,
   consentimiento, `requestId` y replay en el mismo flujo.
3. **Seguir la transacción.** Para cada mutación, comprobar job, ledger, índice y outbox:
   deben quedar juntos o revertirse juntos; un replay no debe crear otro efecto.
4. **Revisar carreras y cierre.** Examinar qué ocurre si cambia el estado, la generación o
   el lease entre dos `await`; distinguir timeout de cancelación durable.
5. **Revisar privacidad y proyección.** Verificar que los DTO/eventos no exponen task,
   cwd, rutas, cuerpos, motivos internos ni detalles del proveedor.
6. **Comparar con la regresión.** La prueba focal sirve para ubicar la intención, pero la
   conclusión debe proceder de la lectura de implementación y callers.
7. **Registrar límites.** Separar lo observado de lo no ejecutado: proveedor remoto,
   migración real, convivencia upstream, Pi 1.0.4 y TUI no quedan acreditados por esta
   revisión.

## Criterio de veredicto

Emitir uno de estos veredictos:

- **APTO para solicitar cierre técnico de 003:** N1–N6 no presentan hallazgos bloqueantes
  y los límites de evidencia están explícitos.
- **NO APTO: corregir N…:** existe al menos un defecto alcanzable que pueda causar pérdida,
  duplicación, bypass de autoridad, fuga de datos, publicación de una generación retirada,
  recuperación incorrecta o migración/replay inválido.

Los hallazgos recomendados no bloqueantes deben separarse de los obligatorios. No convertir
una recomendación opcional en requisito retroactivo sin justificar su impacto.

## Formato de informe

```md
# Revisión independiente de hallazgos de fase 03

Fecha, worktree, rama y base:
Método y restricciones observadas:

## Veredicto
APTO para solicitar cierre técnico de 003
# o
NO APTO: corregir N...

## Hallazgos obligatorios
- N#: archivo:línea o símbolo; caso alcanzable; consecuencia; arreglo mínimo.

## Hallazgos recomendados
- ...

## Hallazgos opcionales
- ...

## Cobertura y límites
- Código/callers inspeccionados:
- N1–N6:
- No ejecutado: tests, TUI, proveedor remoto, migración real, convivencia upstream.
```

El informe debe conservarse como evidencia separada de la aceptación TUI y de los resultados
automáticos. No debe declarar una revisión ejecutada si solo existe una aprobación humana
o una inferencia del estado del repositorio.
