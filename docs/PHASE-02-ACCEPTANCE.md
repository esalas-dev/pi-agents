# Aceptación de fase 02 — control durable del ciclo de vida

Estado: **en validación**. La implementación está en `feat/phase-02`; falta la aceptación TUI humana y el gate de type-check requiere una instalación que no se añade automáticamente.

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
/pi-agents cancel <id> [--reason <texto>] [--yes]
/pi-agents pause <id> [--reason <texto>] [--yes]
/pi-agents resume <id> [--reason <texto>] [--yes]
/pi-agents retry <id> [--reason <texto>] [--yes]
pi_agents_control({ id, action, request_id, reason? })
```

## Gates pendientes

1. Ejecutar `npm run check` con `typescript` disponible en el entorno objetivo; durante esta ejecución `node_modules/typescript/bin/tsc` no está presente y no se instaló ninguna dependencia.
2. Ejecutar `npm test` completo y registrar el resultado del type-check.
3. Realizar smoke Pi y aceptación TUI humana desde un directorio no relacionado.
4. Revisión independiente de la rama y decisión humana sobre promoción/merge.
