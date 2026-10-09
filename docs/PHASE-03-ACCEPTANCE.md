# Aceptación de fase 03 — eventos y RPC versionado

**Estado actual: en validación.** La fase no se declara completada por pruebas automatizadas. Los gates de revisión independiente y aceptación TUI humana permanecen pendientes hasta que se confirme su ejecución con evidencia.

## Criterios AC-03-01..17

| Criterio | Evidencia y estado |
|---|---|
| AC-03-01 | Ping sin sesión, `ready`, capacidades y límites: tests de servidor/adaptadores. Automatización cubierta; aceptación humana pendiente. |
| AC-03-02 | Validación runtime de sobres, DTO, IDs y versiones: `tests/rpc-server.test.mjs`. Automatización cubierta; aceptación humana pendiente. |
| AC-03-03 | Idempotencia y conflictos de mutación: ledger, control, consumo y RPC; automatización cubierta. |
| AC-03-04 | Atomicidad mutación/evento y rollback: suites de repositorio, jobs y outbox; automatización cubierta. |
| AC-03-05 | Duplicado tras emisión/reapertura y orden: `tests/outbox-emitter.test.mjs`; automatización cubierta. |
| AC-03-06 | Paginación de pendientes y ventana reciente: `tests/outbox.test.mjs`; automatización cubierta. No se afirma GC física. |
| AC-03-07 | DTO compactos y límite serializado de resultado: tests de RPC/consulta; automatización cubierta. |
| AC-03-08 | Revisión vigente y consumo idempotente: `tests/review-consume.test.mjs`, autoridad RPC e integración; automatización cubierta. |
| AC-03-09 | Actor extension, propiedad y review prohibido: `tests/rpc-authority.test.mjs`; callerId declarativo, no autenticado. |
| AC-03-10 | Cancelación activa con consentimiento, carrera y pausa no soportada: tests de autoridad y control. Esto no sustituye confirmación TUI humana. |
| AC-03-11 | Deadlines, correlación y respuestas tardías: servidor y `tests/rpc-client.test.mjs`; automatización cubierta, aceptación TUI pendiente. |
| AC-03-12 | Cambio de sesión, generación y cleanup: lifecycle, runtime y cliente; validación interactiva pendiente. |
| AC-03-13 | Allowlist/sanitización de eventos y errores: pruebas de contratos, servidor y outbox; automatización cubierta. |
| AC-03-14 | Migración 4→5 y rechazo/reapertura con fixtures: tests automatizados; no se migró una base real. |
| AC-03-15 | Caller importa `rpc.ts`, instala antes de emitir, deduplica, reconcilia y limpia; namespaces separados: `tests/rpc-integration.test.mjs`. Aislamiento de nombres local, no prueba de convivencia upstream. |
| AC-03-16 | Pasan `npm run check`, `npm test` (216 tests: 215 pass, 1 skip), smoke Pi offline y `npm pack --dry-run --json`; pack: 54 archivos, incluye `rpc.ts`, excluye estado local. No equivale a aceptación TUI. |
| AC-03-17 | Revisión independiente y aceptación TUI humana: pendientes; no inferidas de tests ni smoke. |

## Gates y evidencia observada

| Gate | Estado | Evidencia |
|---|---|---|
| Línea base previa a T9 | Pasó | `npm test`: 207 tests, 206 pass, 1 skip, 0 fail; `npm run check` y `git diff --check` exit 0. Logs locales en `.superpowers/sdd/2026-10-07-fase-03-eventos-rpc/task-9-baseline-*.log`. |
| T9: suite focal de cliente/integración/documento | Pasó | `node --test tests/rpc-client.test.mjs tests/rpc-integration.test.mjs tests/phase-03-acceptance.test.mjs`: 9/9. |
| Gates finales | Pasaron | `npm run check`; `npm test`: 216 tests, 215 pass / 1 skip / 0 fail; `git diff --check`; `npm pack --dry-run --json` (54 archivos, `rpc.ts` incluido y `.pi`/`.cache`/tests/backups/worktrees excluidos); smoke offline exit 0 (`No models matching "__phase03_smoke_no_model__"`). Logs en `.superpowers/sdd/2026-10-07-fase-03-eventos-rpc/task-9-*-final-5.*`. |
| Revisión independiente | Pendiente | No hay veredicto registrado para esta aceptación. |
| Aceptación TUI humana | Pendiente | No se ha ejecutado en este expediente. Requiere autorización y evidencia interactiva real. |

Los gates automáticos no equivalen a revisión independiente ni aceptación TUI humana. El smoke offline demuestra carga de la extensión, no llamada RPC interactiva, aprobación humana ni compatibilidad de convivencia con upstream. No se migró almacenamiento real ni se promovieron datos.
