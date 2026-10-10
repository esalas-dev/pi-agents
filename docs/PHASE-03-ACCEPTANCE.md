# Aceptación de fase 03 — eventos y RPC versionado

## Integración en `main` — registro vigente

**Fase 03 completada e integrada en `main` con límites.** La instrucción humana actual es
«integra y deja cerrado fase 03». Tras `git fetch origin`, se comprobó que los fixes
`9c87c77` (PR #13, merge `7f460a4`) y los cambios locales `4cffcdc` ya son ancestros de
`main` y `origin/main`, ambos en `54e095a` al iniciar esta verificación. El diff entre
`9c87c77` y `54e095a` de los archivos productivos corregidos en N1–N5 y de la fixture N6
está vacío: no se necesita repetir ni cherry-pickear la implementación.

Este cierre concilia README, arquitectura, índice, roadmap y spec/plan/tasks. Las 53 casillas
importadas siguen siendo históricas, no un backlog pendiente ni evidencia nueva de ejecución.
La matriz siguiente conserva la aceptación TUI faux local y la excepción humana por informe
independiente posterior no recuperable; no se atribuye una nueva aceptación interactiva.
Los registros `.cache/` históricos citados abajo no existen en este checkout; se conserva
su referencia documental, no se afirma haberlos recuperado. No se migran bases reales,
publica un paquete ni habilitan las fases 004–010; la constitución sigue sin ratificar.

### Revalidación del cierre integrado — 2026-10-10 (UTC)

Base: `54e095a`, macOS arm64, Node `26.10.0`, npm `11.19.1`, Pi y peers del host
`1.1.0`, Pi Durable y Chord `1.0.1`. Sin cambios productivos ni dependencias nuevas.

| Comprobación ejecutada | Resultado |
|---|---|
| `git fetch origin` y `git merge-base --is-ancestor` | `9c87c77` y `4cffcdc` integrados en `main` y `origin/main`. |
| `npm test` | **338/338**, 0 fallos, cancelaciones, omisiones o TODO; baseline previo 337/337. |
| `node --test tests/phase-03-acceptance.test.mjs` | 2/2; nueva regresión de estados documentales, RED previo 1/2, GREEN 2/2. |
| `npm run check` | Exit 0; TypeScript y sintaxis con peers del host Pi 1.1.0. |
| Smoke Pi offline desde cwd ajeno | Exit 0, stderr vacío, `No models available`; agente/estado temporales, sin proveedor, sesión ni TUI. |
| `npm pack --dry-run --json` | 58 archivos; `rpc.ts` incluido, sin SQLite/tooling/caches/tests; sin publicar. |
| Autocomprobación documental con `node:assert/strict` | 9 documentos, 114 enlaces/anchors locales válidos, fences cerrados; 50 snapshots con SHA-256/bytes intactos y 53 tareas históricas sin alterar. |
| `git diff --check` | Exit 0. |
| Revisión independiente del cambio documental | CLI `openai-codex/gpt-6.1-sol`, high, exit 0 y stderr vacío: **APTO**, sin bloqueantes. Señaló un hueco menor en la regresión, corregido añadiendo los pasajes operativos de roadmap/conciliación. Seguimiento independiente acotado: **APTO**, finding corregido, sin hallazgos nuevos (exit 0, stderr vacío). No es una rerevisión técnica de N1–N6 ni reemplaza la excepción histórica. |

Logs nuevos ignorados: `.cache/pi-agents/verification/phase03-integration-*`.
El smoke usa `PI_OFFLINE=1`, `PI_CODING_AGENT_DIR` temporal, `--no-extensions`,
`--no-mcp`, `--no-skills`, `--no-prompt-templates`, `--no-context-files`, `--no-session`,
`--extension <ruta-absoluta>/index.ts` y `--list-models __phase03_smoke_no_model__`.
Esta revalidación no sustituye ni amplía la aceptación TUI o la excepción humana históricas.

## Registro humano posterior — 2026-10-10

La persona declaró: «doy por aporvada la revisión independiente favorable posterior a N1–N6».
Se registra como aceptación humana del veredicto favorable para solicitar el cierre técnico.
No se recuperó un informe independiente posterior porque el almacenamiento del agente reviewer
falló; por trazabilidad, esta declaración no se presenta como un informe independiente ejecutado.
Registro: `.cache/pi-agents/verification/phase03-independent-rereview-human-approval.md`.

La persona añadió: «listo, APTO para solicitar cierre», «cierra las valicaciones de fase 03» y
finalmente «CIERRA, COMPLETA, TERMINA, PROMOCIONA FASE 03».
Se registra el cierre y la promoción administrativa con límites. Evidencia:
`.cache/pi-agents/verification/phase03-closure-request.md`,
`.cache/pi-agents/verification/phase03-validation-closure.md` y
`.cache/pi-agents/verification/phase03-promotion.md`.
La guía operativa de validación está en `docs/PHASE-03-FINDINGS-VALIDATION.md`.

**Estado del cierre administrativo anterior: fase 03 completada y promocionada con límites.** La revisión independiente inicial finalizó **NO APTO**; N1–N5 fueron revalidados y corregidos localmente, N6 fue validada y la persona aceptó el veredicto favorable posterior. La persona declaró «acepto la TUI de 003» y ordenó completar/promocionar la fase; se registra la decisión con su excepción explícita por informe independiente no recuperable. Evidencia: `.cache/pi-agents/verification/phase03-promotion.md`.

## Continuación de cierre — `011-cierre-widget`, 2026-10-09

011 ya recibió aceptación humana de su guía TUI local. Se inicia la revisión
independiente de **003** previamente autorizada: CLI `openai-codex/gpt-6.1-sol`,
razonamiento high, solo read/grep/find/ls, sin extensiones/MCP, perfiles ni escritura.
Solicitud y salida en evidencia ignorada `.cache/pi-agents/verification/phase03-*`.
**Finalizada: exit 0, stderr vacío, veredicto NO APTO.** El asistente lanzador
guardó logs; el revisor no modificó archivos ni ejecutó tests. Reportó cinco
hallazgos obligatorios (N1–N5), posteriormente revalidados y corregidos: consentimiento indebido
para queued/paused, control sin despertar al coordinador, recibo provisioning
fuera del DTO público, publicaciones de generaciones retiradas y aborto perdido
durante adquisición de watch. Se añadieron regresiones focales; el veredicto favorable posterior fue aceptado
humanamente con la excepción por informe no recuperable registrada arriba. N6 quedó revisada con una fixture v4 válida
para recuperación/replay: migración, replay idempotente del ledger y reapertura de un `running`
con IDs Durable reales pasan en `tests/migration-v4.test.mjs`. Evidencia local ignorada:
`phase03-n6-review.md`. La revisión del widget no sustituye este gate.

La suite de aquel worktree se repitió (evidencia histórica): **335/335**, sin fallos, cancelaciones,
omisiones ni TODO, y `npm run check` exit 0. Incluye seis regresiones focales de N1–N5;
los logs `widget-human-acceptance-{tests,check}.log` se citaron como baseline histórico, no recuperado ahora.
Los conteos 216/215+1 y pack 54 de las tablas siguientes son históricos, no el
baseline vigente. No hubo nuevos cambios de RPC/outbox ni migraciones reales.
La aceptación humana de TUI de 003 se recibió el 2026-10-09, literalmente
«acepto la TUI de 003». El alcance fue precisado: se observaron todos los bloques de la
guía, directamente en una TUI visible e interactiva, sobre el candidato faux local temporal
de este worktree. No se probaron proveedores remotos ni migraciones reales. Registro ignorado:
`phase03-tui-user-acceptance.md`. No se aportan capturas o logs independientes; la aceptación
no sustituye la revisión técnica ni acredita compatibilidad remota o migración real. Constitución pendiente;
004–010 siguen bloqueadas.

## Criterios AC-03-01..17

| Criterio | Evidencia y estado |
|---|---|
| AC-03-01 | Ping sin sesión, `ready`, capacidades y límites: tests de servidor/adaptadores. Automatización cubierta; aceptación humana de la guía recibida con los límites indicados arriba. |
| AC-03-02 | Validación runtime de sobres, DTO, IDs y versiones: `tests/rpc-server.test.mjs`. Automatización cubierta; aceptación humana de la guía recibida con los límites indicados arriba. |
| AC-03-03 | Idempotencia y conflictos de mutación: ledger, control, consumo y RPC; automatización cubierta. |
| AC-03-04 | Atomicidad mutación/evento y rollback: suites de repositorio, jobs y outbox; automatización cubierta. |
| AC-03-05 | Duplicado tras emisión/reapertura y orden: `tests/outbox-emitter.test.mjs`; automatización cubierta. |
| AC-03-06 | Paginación de pendientes y ventana reciente: `tests/outbox.test.mjs`; automatización cubierta. No se afirma GC física. |
| AC-03-07 | DTO compactos y límite serializado de resultado: tests de RPC/consulta; automatización cubierta. |
| AC-03-08 | Revisión vigente y consumo idempotente: `tests/review-consume.test.mjs`, autoridad RPC e integración; automatización cubierta. |
| AC-03-09 | Actor extension, propiedad y review prohibido: `tests/rpc-authority.test.mjs`; callerId declarativo, no autenticado. |
| AC-03-10 | Cancelación activa con consentimiento, carrera y cancelación queued/paused sin consentimiento activo: tests de autoridad y control. Esto no sustituye confirmación TUI humana. |
| AC-03-11 | Deadlines, correlación, timers retirados y respuestas tardías: servidor y `tests/rpc-client.test.mjs`; automatización focal ampliada; aceptación humana de la guía recibida con límites. |
| AC-03-12 | Cambio de sesión, generación, ready tardío y cleanup: lifecycle, runtime y cliente; aceptación humana de la guía recibida con límites. |
| AC-03-13 | Allowlist/sanitización de eventos y errores: pruebas de contratos, servidor y outbox; automatización cubierta. |
| AC-03-14 | Migración 4→5 y rechazo/reapertura con fixtures: tests automatizados; N6 añade fixture v4 válida con recuperación de `running` y replay canónico; no se migró una base real. |
| AC-03-15 | Caller importa `rpc.ts`, instala antes de emitir, deduplica, reconcilia y limpia; namespaces separados: `tests/rpc-integration.test.mjs`. Aislamiento de nombres local, no prueba de convivencia upstream. |
| AC-03-16 | Gates históricos: `npm run check`, `npm test` (216 tests: 215 pass, 1 skip), smoke Pi offline y pack 54 archivos. Revalidación histórica del cierre: `npm test` 335/335, `npm run check` y `git diff --check` verdes; no equivale a aceptación TUI. |
| AC-03-17 | Revisión independiente inicial NO APTO; N1–N5 corregidos y N6 cubierta por fixture v4 válida. La persona aceptó el veredicto favorable posterior y ordenó completar/promocionar la fase. El informe independiente no está recuperable; la excepción humana queda registrada sin atribuir una inspección inexistente. Fase completada y promocionada administrativamente con límites. |

## Gates y evidencia histórica observada

| Gate | Estado | Evidencia |
|---|---|---|
| Línea base previa a T9 | Pasó | `npm test`: 207 tests, 206 pass, 1 skip, 0 fail; `npm run check` y `git diff --check` exit 0. Logs locales en `.superpowers/sdd/2026-10-07-fase-03-eventos-rpc/task-9-baseline-*.log`. |
| T9: suite focal de cliente/integración/documento | Pasó | `node --test tests/rpc-client.test.mjs tests/rpc-integration.test.mjs tests/phase-03-acceptance.test.mjs`: 9/9. |
| Gates finales | Pasaron | `npm run check`; `npm test`: 216 tests, 215 pass / 1 skip / 0 fail; `git diff --check`; `npm pack --dry-run --json` (54 archivos, `rpc.ts` incluido y `.pi`/`.cache`/tests/backups/worktrees excluidos); smoke offline exit 0 (`No models matching "__phase03_smoke_no_model__"`). Logs en `.superpowers/sdd/2026-10-07-fase-03-eventos-rpc/task-9-*-final-5.*`. |
| Revisión independiente | Completada por decisión humana | Informe inicial exit 0, NO APTO; N1–N5 corregidos y N6 cubierta. La persona aceptó el veredicto favorable posterior y ordenó la promoción; el informe independiente posterior no se recuperó por fallo de almacenamiento del reviewer. Excepción humana explícita registrada. |
| Aceptación TUI humana | Completada con límites | Se observaron todos los bloques de la guía en TUI visible/interactiva, candidato faux local temporal de este worktree. Sin proveedor remoto ni migración real; no sustituye la revisión técnica. |

Los gates automáticos no equivalen a revisión independiente ni aceptación TUI humana. El smoke offline demuestra carga de la extensión, no llamada RPC interactiva, aprobación humana ni compatibilidad de convivencia con upstream. No se migró almacenamiento real ni se promovieron datos.
