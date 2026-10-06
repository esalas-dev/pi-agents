# 08 — Scheduling durable

## Estado y dependencias

Propuesta. Depende de 01–07.

## Objetivo

Crear trabajos en instantes programados con deduplicación durable, políticas explícitas para ejecuciones perdidas y control humano. V1 no introduce un daemon: las programaciones solo se evalúan cuando la sesión propietaria está abierta.

## Alcance temporal

Formatos V1:

- cron de seis campos: segundo, minuto, hora, día del mes, mes, día de semana;
- intervalo: `30s`, `5m`, `2h`, `1d`;
- relativo único: `+10m`, `+2h`, `+1d`;
- absoluto ISO 8601 con zona.

Toda programación se normaliza a UTC, conservando la zona declarada para calcular cron. Si no se declara zona se usa la zona local capturada al crear, no la zona que tenga el proceso en el futuro.

## Propiedad y ejecución

- Cada schedule pertenece a una sesión principal y su SQLite.
- Solo un proceso puede poseer esa SQLite.
- Al cerrar Pi no se ejecutan jobs en segundo plano fuera del proceso.
- Al reabrir se aplica la política de misfire.
- Cambiar de sesión desarma el scheduler anterior y arma el nuevo.

## Política de misfire

Opciones:

- `skip` (predeterminada): omite disparos vencidos y programa el siguiente.
- `run_once`: crea un solo job representando todos los vencidos.
- `catch_up`: crea hasta N ejecuciones, máximo inicial 10.

Cada omisión o catch-up queda auditado. Nunca se crean ejecuciones ilimitadas tras una ausencia larga.

## Identidad e idempotencia

Cada ocurrencia tiene:

```text
occurrenceKey = sha256(scheduleId + plannedAt)
requestId = schedule:<scheduleId>:<plannedAt-iso>
```

Crear el job y registrar la ocurrencia debe ocurrir en un commit coordinado. Si no pueden compartir documento/transacción, primero se reserva la ocurrencia y luego se crea el job idempotentemente. Reabrir nunca duplica la misma `plannedAt`.

## Resolución del agente

V1 usa `resolutionPolicy: "snapshot"`:

- al crear schedule se resuelven agente, tools, modelo, thinking, cwd, schema, gates e isolation;
- cada ocurrencia copia ese snapshot;
- editar el archivo de agente no altera schedules existentes.

Una operación humana `refresh` reemplaza el snapshot para ocurrencias futuras y registra hash anterior/nuevo. No cambia jobs ya creados.

## Requisitos funcionales

### RF-01 — Crear

Requiere nombre de agente, tarea, expresión, zona, misfire y opcionalmente fecha final/cantidad máxima. Los mismos validadores de un spawn normal se ejecutan al crear.

### RF-02 — Pausar y reanudar schedule

Pausar evita futuras ocurrencias; no pausa jobs ya creados. Reanudar calcula desde el instante actual y aplica política de misfire según `pausedAt` y configuración explícita.

### RF-03 — Eliminar

Eliminar marca `deleted` y desarma timer. No cancela jobs existentes. El registro se conserva para auditoría y deduplicación.

### RF-04 — Una sola ejecución

Relativo y absoluto pasan a `completed` después de reservar su única ocurrencia, incluso si el job luego falla. Retry del job usa fase 02; no vuelve a dispararse el schedule.

### RF-05 — Límites

- máximo 100 schedules activos por sesión;
- frecuencia mínima 10 segundos;
- máximo 10 catch-up por activación;
- tarea máximo igual al spawn normal;
- un timer físico puede representar el próximo deadline; el resto se calcula durablemente.

## Interfaces

### Comandos

```text
/pi-agents schedule create <agente> "<tarea>" --at <expr> [--timezone <tz>]
/pi-agents schedule list
/pi-agents schedule status <id>
/pi-agents schedule pause <id>
/pi-agents schedule resume <id>
/pi-agents schedule delete <id>
/pi-agents schedule refresh <id>
```

Crear, refresh y delete requieren confirmación humana en TUI. La tool de modelo puede crear schedules solo si una política explícita lo habilita; predeterminado: deshabilitado.

### RPC y tool

Tool opcional `pi_agents_schedule` con acciones discriminadas. RPC refleja capacidades. Mutaciones requieren requestId.

Eventos:

- `schedule.created`
- `schedule.paused`
- `schedule.resumed`
- `schedule.deleted`
- `schedule.refreshed`
- `schedule.occurrence-reserved`
- `schedule.job-created`
- `schedule.misfire-skipped`
- `schedule.error`

## Modelo persistente

```ts
interface ScheduleRecord {
  id: string;
  status: "active" | "paused" | "completed" | "deleted" | "error";
  expression: ScheduleExpression;
  timezone: string;
  misfire: "skip" | "run_once" | "catch_up";
  maxCatchUp: number;
  snapshot: StartJobInput;
  snapshotHash: string;
  createdAt: number;
  nextPlannedAt?: number;
  lastPlannedAt?: number;
  occurrenceCount: number;
  maxOccurrences?: number;
  endAt?: number;
  createdBy: Actor;
}
```

`OccurrencesDoc` guarda key, plannedAt, reservedAt, jobId y resultado de creación. Retención/configuración de compactación debe conservar claves mientras el schedule exista para evitar duplicados.

## Recuperación

1. abrir documentos;
2. reclamar propiedad de scheduler para la sesión;
3. reconciliar ocurrencias reservadas sin job;
4. calcular misfires;
5. reservar/crear según política y límites;
6. armar próximo timer;
7. emitir `scheduler-ready` con conteos.

Una caída después de reservar y antes de crear usa el mismo requestId. Una caída después de crear y antes de enlazar busca el job por `createdFromOccurrence`.

## Seguridad y autoridad

- El scheduler ejecuta instrucciones futuras con permisos del proceso; creación por modelo está apagada por defecto.
- Schedules de proyecto se crean solo en proyecto confiado.
- No se re-resuelven agentes automáticamente, evitando que una edición posterior amplíe privilegios.
- Ningún schedule aprueba resultados ni promueve ramas.
- La UI muestra próximo disparo, actor, snapshot y política de ausencia.

## Errores

- `SCHEDULE_INVALID_EXPRESSION`
- `SCHEDULE_INVALID_TIMEZONE`
- `SCHEDULE_TOO_FREQUENT`
- `SCHEDULE_LIMIT_EXCEEDED`
- `SCHEDULE_NOT_FOUND`
- `SCHEDULE_MODEL_CREATION_FORBIDDEN`
- `SCHEDULE_SNAPSHOT_INVALID`
- `SCHEDULE_OWNERSHIP_CONFLICT`

## Criterios de aceptación

1. Una ocurrencia produce como máximo un job pese a cierres en cada ventana.
2. Zona y DST producen instantes documentados y testeados.
3. `skip`, `run_once` y `catch_up` cumplen límites tras una ausencia.
4. Pausar no cancela jobs existentes.
5. Un schedule one-shot no se repite si su job falla.
6. Editar un agente no cambia el snapshot hasta refresh humano.
7. El modelo no crea schedules con política predeterminada.
8. Dos procesos no pueden operar deliberadamente la misma SQLite.
9. El scheduler no vive después de `session_shutdown`.
10. Resultados creados siguen la política normal de revisión.

## Pruebas

- Reloj inyectable; sin sleeps reales.
- Cron, intervalos, ISO, DST, zonas inválidas.
- Ausencias largas y límites de catch-up.
- Caídas en reserva, creación y enlace.
- Pausa/reanudación/delete concurrentes con disparo.
- Snapshot y refresh.
- Migración desde fase 07.

## Fuera de alcance

- Daemon o launchd.
- Schedules globales entre sesiones.
- Alta disponibilidad multi-proceso.
- Calendarios externos.
