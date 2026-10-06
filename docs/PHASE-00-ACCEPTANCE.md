# Aceptación de fase 00

Fecha de esta ejecución: 2026-10-06. Entorno: macOS arm64, Node 26.10.0, Pi 1.0.4, `pi-durable` 1.0.1.

## Evidencia ejecutada

| Evidencia | Resultado |
|---|---|
| `npm run check` | Verde: type-check host y sintaxis recursiva de `src/`. |
| `npm test` | Verde: 54 pruebas. Incluye dominio, repositorio, migración de cinco fixtures, runtime, coordinador y adaptadores. |
| `node --test tests/crash-recovery.test.mjs` | Verde: SIGKILL de subprocess, lock residual observable, liberación manual tras confirmar muerte y reapertura del lock. |
| Smoke `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_smoke_no_match__` | Verde; Pi respondió `No models matching ...`, sin error de carga ni acceso al almacenamiento. |
| `npm pack --dry-run --json` | Verde: 28 archivos esperados, sin `tests/`, backups ni configuración local; no se publica desde esta rama. |

## AC-00–17

- **AC-00–05:** cubiertos por el baseline, type-check, contratos de dominio, documentos separados, repositorio transaccional, resultados diferidos y ledger idempotente.
- **AC-06–08:** cubiertos por canonización, replay concurrente, transición durables y equivalencia campo a campo en `tests/migration.test.mjs` para `queued`, `provisioning`, `running`, `terminal-mix` y `large-result`.
- **AC-09:** cubierto por autorización humana TUI-only en el adaptador y migración headless denegada; la prueba actual valida la política, no un diálogo TUI interactivo.
- **AC-10–11:** cubiertos por inspección de versiones, corrupción/desconocidos, aliases, locks y backup SQLite verificado.
- **AC-12–13:** cubiertos parcialmente: el subprocess demuestra el lock residual; no se han instrumentado todas las barreras de caída de ejecución y migración.
- **AC-14:** cubierto por notificación diferida, repetible y fallo de notificación sin alterar el resultado.
- **AC-15:** cubierto por actores, snapshots de agente y migración sin autor inventado.
- **AC-16:** cubierto por inventario, smoke y host type-check; la prueba TUI manual sigue pendiente.
- **AC-17:** este documento registra comandos y límites; la revisión independiente y la aceptación humana no se simulan.

## Operación de mantenimiento

La migración v1 se solicita desde un comando/adaptador autorizado, crea backup antes de convertir y publica el esquema 2 en un commit Durable. Si Pi termina mediante `SIGKILL`, el lock puede quedar presente. Confirmar primero que el proceso murió, conservar/copiar el estado si es necesario y retirar manualmente únicamente el lock residual verificado; nunca eliminarlo por antigüedad mientras el propietario pueda seguir vivo.

Para restaurar una copia, cerrar Pi, trabajar en una ruta nueva y no copiar sidecars WAL/SHM antiguos. No hay downgrade automático ni rollback de efectos externos de agentes.

## Limitaciones abiertas

No se ejecutó una sesión TUI humana con un agente sintético ni una revisión independiente en otra sesión. Por tanto, la fase queda **en validación**, no se declara aceptada integralmente ni se actualiza el roadmap a completada. La cobertura de subprocess actual caracteriza la propiedad del lock; no demuestra por sí sola todas las ventanas de caída `submission-admitted`, `terminal-committed`, `backup-verified` y `migration-committed`.
