# Aceptación de fase 02 — control durable del ciclo de vida

Estado: **completada por aprobación humana**. La implementación fue fusionada mediante PR #4 y la regresión de integración fue corregida mediante PR #5. La persona responsable aprobó las pruebas humanas, confirmó «PR validado» y solicitó actualizar el cierre. El `main` resultante (`f87d77e`) fue revalidado: type-check, sintaxis, 99/99 pruebas y smoke offline verdes. Se conservan a continuación los límites de la evidencia histórica y del informe independiente.

## Alcance implementado

| Criterio | Evidencia | Estado |
| --- | --- | --- |
| Pausar y reanudar jobs en cola | `tests/control.test.mjs` | Pasa |
| Cancelar jobs `queued`/`paused` | `tests/control.test.mjs` | Pasa |
| Cancelación cooperativa activa | `tests/control-recovery.test.mjs`, `tests/crash-recovery.test.mjs` | Pasa |
| Pausa activa explícitamente no soportada | `PAUSE_ACTIVE_UNSUPPORTED` en contratos, repositorio y adapters | Pasa |
| Retry inmutable enlazado | `tests/retry.test.mjs` | Pasa |
| Idempotencia, conflicto y precedencia | `tests/control.test.mjs`, `tests/retry.test.mjs` | Pasa |
| Migración explícita 3→4 con backup | `tests/migration-v3.test.mjs` | Pasa |
| Runtime bloqueado antes de esquema 4 | `tests/session-control-runtime.test.mjs` | Pasa |
| Comandos y tool Pi | `tests/command.test.mjs`, `tests/pi-control-adapters.test.mjs` | Pasa |
| Historial y ledger durable | `JobControlDocFamily`, `controlHistory`, `RequestLedgerDocFamily` | Pasa |

## Semántica pública

- Estados nuevos: `paused`, `cancelling` y `cancelled`.
- `interrupted` significa que el aborto no pudo confirmarse; no se presenta como `cancelled`.
- La cancelación activa persiste primero `control.pending` y luego usa APIs públicas de Pi Durable.
- `pause` sobre ejecución activa devuelve `PAUSE_ACTIVE_UNSUPPORTED`; no se mantiene un flag engañoso.
- Cada retry crea un job nuevo con `retryOf`, `rootAttemptId` y `attemptNumber`; no copia resultado, consumo ni notificación.
- La tool exige `request_id`. El modelo no controla jobs humanos bajo la política predeterminada. La cancelación activa requiere TUI con UI activa y confirmación.

## Comandos y herramientas

```text
/subagents cancel <id> [--reason <texto>] [--yes]
/subagents pause <id> [--reason <texto>] [--yes]
/subagents resume <id> [--reason <texto>] [--yes]
/subagents retry <id> [--reason <texto>] [--yes]
pi_agents_control({ id, action, request_id, reason? })
```

## Evidencia histórica de gates ejecutados

| Comando | Resultado |
| --- | --- |
| `npm run check` | El comando directo queda bloqueado por `tsc: command not found`; no se instaló ninguna dependencia. Con el `tsc` ya existente en el worktree de fase 00 mediante `PATH=... npm run check`, pasa type-check y sintaxis. |
| Type-check directo con el `tsc` existente | Pasa sin salida; no se modificó el host. |
| `npm test` | 95 pasan, 2 fallan únicamente porque `tests/typecheck.test.mjs` busca el binario ausente en `node_modules/typescript/bin/tsc`. |
| Suite sin `tests/typecheck.test.mjs` | 94/94 pasan. |
| `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models ...` | Pasa; no encontró modelos coincidentes. |
| `npm pack --dry-run --json` | Pasa; no incluye SQLite, backups ni configuración local. |

## Evidencia TUI ejecutada

Sesión `phase02-tui`, con `PI_AGENTS_CONCURRENCY=1` y almacenamiento temporal:

- pausa de un job `queued`: `pause → paused`;
- reanudación: `resume → queued`, con posición visible;
- cancelación `queued`: `cancel → cancelled`;
- retry: creó un ID nuevo y dejó el intento original `cancelled` e inmutable;
- pausa activa: devolvió `PAUSE_ACTIVE_UNSUPPORTED`;
- cancelación activa: confirmó `cancel → cancelled` mediante TUI;
- migración 3→4: autorización TUI aceptada; después de cerrar la sesión, `inspectStorage` confirmó `schemaVersion: 4`.

La fixture de migración contenía conversaciones/submissions inexistentes y modelo `faux`; por eso la reapertura produjo errores esperables en jobs `queued`, `provisioning` y `running`. Los estados terminales y el job `paused` se conservaron correctamente. Esto cuenta como evidencia TUI parcial, no como aceptación final limpia.

## Revalidación automatizada — 2026-10-06 (2026-10-07 UTC)

Checkout: `.worktrees/phase-02`, rama `feat/phase-02`, código en `d97118247e5a008a6961b1162aded15d544c0a55`. Node `26.10.0`, Pi host `1.0.4`.

- `npm ci --omit=peer`: instalación exacta desde el lockfile, con TypeScript `5.9.3` y `@types/node` `26.6.4`; sin materializar el peer local de Pi. Se retiraron metadatos `.DS_Store` de `node_modules` que impedían su limpieza.
- `npm run check`: type-check contra los tipos del host Pi `1.0.4` y sintaxis verdes (código 0).
- `npm test`: **99/99 pasan**, sin fallos, cancelaciones ni pruebas omitidas; incluye las pruebas de TypeScript antes bloqueadas.
- `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models '__phase02_smoke_no_model__'`: código 0, sin modelos coincidentes. Acredita carga offline, no aceptación TUI.
- `npm pack --dry-run --json`: código 0, 37 archivos; no incluye SQLite, backups ni configuración local.
- La instalación y los gates no modificaron archivos versionados. Esta actualización documental registra la evidencia nueva sin borrar las limitaciones de las ejecuciones anteriores.

## Regresión detectada tras fusionar PR #4

En `main` (`3353895`), la revalidación produjo **96/98 pruebas verdes** y dos fallos de registro de tools. La integración `5bda621` había eliminado el registro de `pi_agents_control`, una prueba de comandos de control y la expectativa de la sexta tool en `tests/pi-adapters.test.mjs`. El type-check seguía verde: no detecta la ausencia de un registro runtime.

La rama `fix/phase02-control-merge` restaura esos tres cambios exactamente como estaban en `d971182`, sin modificar la política de autorización ni añadir comportamiento nuevo. Se observaron las pruebas de registro fallar antes de restaurar la tool. Después de la restauración:

- `npm run check`: código 0, contra Pi host `1.0.4`.
- `npm test`: **99/99 pasan**, sin fallos ni pruebas omitidas.
- Smoke offline de carga: código 0, sin invocar modelo.
- `git diff --check`: sin errores.

Esta evidencia corresponde a la rama de corrección, no a `main` antes de integrarla.

## Aprobación humana — 2026-10-06 (2026-10-07 UTC)

La persona responsable confirmó explícitamente en esta sesión: **«doy por aprobadas las pruebas humanas»**. Se registra como aprobación humana del gate de aceptación TUI de fase 02, separado de los gates automatizados del PR #5 (`ecdb46c`, 99/99 pruebas).

Esta aprobación no afirma que el asistente haya ejecutado nuevos escenarios TUI ni borra las limitaciones de la evidencia histórica. No se aportaron nuevos logs interactivos. Tampoco equivale a aprobar el informe independiente ni a autorizar el merge del PR #5.

## Cierre y revalidación del código integrado — 2026-10-07 UTC

- Implementación: [PR #4](https://github.com/esalas-dev/pi-durable-subagents/pull/4), fusionado en `3353895`.
- Corrección de la regresión: [PR #5](https://github.com/esalas-dev/pi-durable-subagents/pull/5), fusionado en `f87d77eba4ba99129a8b9bef6b576cec1309e05a`.
- Decisión humana posterior a la aprobación de pruebas: **«PR validado»**; GitHub confirmó el merge del PR #5. La persona responsable solicitó actualizar el cierre documental.
- `main` local sincronizado por avance rápido con `origin/main`; ambos apuntan a `f87d77e`.
- `npm run check`: código 0, type-check contra Pi host `1.0.4` y sintaxis correctos.
- `npm test`: **99/99 pasan**, sin fallos, cancelaciones ni pruebas omitidas.
- `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models '__phase02_final_main_smoke__'`: código 0, sin invocar modelo.

La revisión independiente de la corrección fue ejecutada por el agente `phase01-reviewer` (trabajo `psa_1791350106420_9e0813632ca9e`), que terminó con un resultado disponible sujeto a revisión humana. El asistente no recuperó ese informe ni afirma un veredicto técnico favorable o que la persona responsable haya leído su contenido. El cierre se registra por la aprobación y decisión de promoción humanas explícitas, no por una aprobación automática del informe.

No se registran gates pendientes de ejecución de fase 02 tras esta decisión humana. Permanecen las limitaciones de evidencia indicadas: ausencia de nuevos logs TUI, smoke solo offline y pausa activa no soportada. La fase 03 puede iniciar su diseño; su spec sigue siendo propuesta y requiere decisiones y aprobación antes de implementar.
