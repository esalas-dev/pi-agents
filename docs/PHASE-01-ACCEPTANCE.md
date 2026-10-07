# Aceptación de fase 01 — Consulta, listado y espera

## Estado

`en validación`. La implementación está presente en la rama `feat/phase-01`, pero esta matriz no declara la fase completada hasta ejecutar los gates finales, la revisión independiente y la aceptación humana TUI.

## Alcance operativo

La fase añade consulta por ID, listado de la sesión, espera no cancelante, resultados `peek`/`consume`, revisión humana y migración explícita del esquema 2 al esquema 3.

Comandos:

```text
/pi-agents status <id>
/pi-agents result <id>
/pi-agents list [--status <estado>] [--limit <n>] [--cursor <cursor>]
/pi-agents wait <id> [--until <estado>] [--timeout <segundos>]
/pi-agents approve <id> [--reason <texto>]
/pi-agents reject <id> [--reason <texto>]
```

Tools:

- `pi_agents_status`
- `pi_agents_list`
- `pi_agents_wait`
- `pi_agents_result`

El cursor es opaco y ordena por `(createdAt,id)` descendente. `wait` usa snapshot → suscripción → snapshot; su timeout o aborto no modifica el job. Las tools nunca aprueban resultados ni reciben cuerpos `pending` o `rejected`. `consume` exige `request_id` y el ledger durable deduplica la solicitud.

El texto de una tool se limita a 64 KiB. Los resultados mayores conservan el cuerpo completo en SQLite y exponen prefijo, longitud total, SHA-256 e indicador de truncado. La vista humana no aplica ese truncado.

## Migración y recuperación

Una base del esquema 2 no abre el Harness: requiere mantenimiento TUI, migración humana autorizada, backup consistente y conversión atómica 2 → 3. La migración crea documentos separados de revisión y consumo, conserva jobs, cola, resultados y notificaciones, y registra su actor e instante. Una base ya en esquema 3 es idempotente.

Después de cerrar y reabrir Pi se reconstruyen consultas y esperas desde documentos Durable; no se persisten promesas ni timers como autoridad. Revisión, consumo y ledger sobreviven a la reapertura.

## Matriz AC-01

| Criterio | Evidencia automatizada | Estado | Limitación |
| --- | --- | --- | --- |
| Consulta y listado sin materializar resultados | `tests/query.test.mjs`, `npm test` | verificado | Falta smoke TUI interactivo |
| Cursor estable con timestamps repetidos | `tests/query.test.mjs` | verificado | Solo sin inserciones entre páginas |
| Carrera snapshot/watch, timeout y aborto | `tests/wait.test.mjs` | verificado | No prueba cierre concurrente de sesión |
| Revisión humana separada de tools | `tests/review-consume.test.mjs`, `tests/pi-query-adapters.test.mjs` | verificado | Falta aceptación TUI humana |
| Consumo idempotente y replay del ledger | `tests/review-consume.test.mjs` | verificado | La semántica sin `requestId` no se ofrece |
| Truncado UTF-8 a 64 KiB con hash | `tests/pi-query-display.test.mjs`, `npm test` | verificado | Falta aceptación TUI interactiva |
| Migración explícita esquema 2 → 3 | `tests/migration-v2.test.mjs`, `npm test` | verificado | Backup probado en Node local |
| Bloqueo de runtime en esquema 2 | `tests/session-query-runtime.test.mjs` | verificado | Falta prueba TUI de la confirmación |
| Cierre y reapertura | `tests/session-query-runtime.test.mjs`, `tests/review-consume.test.mjs` | verificado | No se afirma aceptación interactiva |

## Gates ejecutados

- `npm run check`: verde.
- `npm test`: verde, 81/81 pruebas.
- `PI_OFFLINE=1 pi --no-extensions --extension "$PWD/index.ts" --list-models __pi_agents_phase01_smoke_no_match__`: código 0; no se invocó ningún modelo.
- `npm pack --dry-run --json`: paquete sin SQLite, backups, configuración local ni `node_modules`.

## Gates pendientes

- Revisión independiente del branch.
- Validación humana TUI de listado, espera, resultado, aprobación, rechazo y migración.

La evidencia se actualiza únicamente con comandos realmente ejecutados; la aceptación humana no se infiere de las pruebas unitarias.
