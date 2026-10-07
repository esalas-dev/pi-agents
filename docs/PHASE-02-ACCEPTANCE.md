# Aceptación de fase 02 — control durable del ciclo de vida

Estado: **en validación**. La implementación está en `feat/phase-02`; los gates automatizados se han repetido correctamente con dependencias locales. Siguen pendientes la aceptación TUI humana final, la revisión independiente y la decisión humana de promoción/merge.

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

## Gates pendientes

1. Realizar smoke TUI humano desde un directorio no relacionado: cancelación confirmada, pausa queued, resume, retry y migración.
2. Revisión independiente de la rama y decisión humana sobre promoción/merge.
