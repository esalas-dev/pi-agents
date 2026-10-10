# Feature Specification: Scheduling durable

**Feature Branch**: `008-scheduling-durable` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: propuesta bloqueada; parser y políticas pendientes

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/08-scheduling-durable.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Programar jobs por sesión sin duplicar ocurrencias (Priority: P1)

Crear jobs programados con snapshots, misfire explícito y deduplicación, sin daemon externo.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** la sesión vuelve a abrirse después de varias ocurrencias perdidas,
   **Then** se aplica la política de misfire y cada ocurrencia conserva su job sin duplicados.
2. **Given** entradas inválidas, límites excedidos o autoridad insuficiente, **When** se solicita
   la operación definida, **Then** se aplica el rechazo o degradación explícitos del contrato,
   sin efectos ocultos ni exposición de contenido no autorizado.

### Edge Cases

Se conservan los casos de error, carreras, versiones, privacidad y recuperación del contrato
migrado. Los límites y bloqueos del roadmap no se resuelven mediante esta conversión documental.

## Alcance y controles constitucionales *(mandatory)*

- **Persistencia e idempotencia**: aplicar la fuente durable, requestId y recuperación definidos en
  los requisitos de dominio; una proyección no sustituye a SQLite.
- **Autoridad**: ejecutar o verificar no aprueba; lectura, consumo y promoción siguen separados.
- **Seguridad**: validar entradas/rutas y acotar exposición según el contrato; no prometer sandbox.
- **Contratos**: usar APIs públicas y servicios comunes; no inventar capacidades de fases posteriores.
- **Dependencias y alcance**: consultar [roadmap](../ROADMAP.md) y las exclusiones preservadas abajo.
- **Estado de autorización**: Propuesta bloqueada. No hay plan ni tareas aprobados y no se generan en esta migración.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE reservar durablemente cada ocurrencia antes de crear su job y conservar su identidad al reabrir.
- **FR-002**: El sistema DEBE evaluar cron, intervalo y programación única con zona, DST y políticas skip, run_once y catch_up acotadas.
- **FR-003**: El sistema DEBE controlar schedules con autoridad humana y snapshots estables; pausar no cancela jobs ya creados.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- `ScheduleRecord` conserva expresión, plantilla, snapshot y políticas.
- Ocurrencia relaciona reservationId, instante UTC y job creado sin duplicados.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Objetivo

Crear trabajos en instantes programados con deduplicación durable, políticas explícitas para ejecuciones perdidas y control humano. V1 no introduce un daemon: las programaciones solo se evalúan cuando la sesión propietaria está abierta.

### Alcance temporal

Formatos V1:

- cron de seis campos: segundo, minuto, hora, día del mes, mes, día de semana;
- intervalo: `30s`, `5m`, `2h`, `1d`;
- relativo único: `+10m`, `+2h`, `+1d`;
- absoluto ISO 8601 con zona.

Toda programación se normaliza a UTC, conservando la zona declarada para calcular cron. Si no se declara zona se usa la zona local capturada al crear, no la zona que tenga el proceso en el futuro.

### Propiedad y ejecución

- Cada schedule pertenece a una sesión principal y su SQLite.
- Solo un proceso puede poseer esa SQLite.
- Al cerrar Pi no se ejecutan jobs en segundo plano fuera del proceso.
- Al reabrir se aplica la política de misfire.
- Cambiar de sesión desarma el scheduler anterior y arma el nuevo.

### Política de misfire

Opciones:

- `skip` (predeterminada): omite disparos vencidos y programa el siguiente.
- `run_once`: crea un solo job representando todos los vencidos.
- `catch_up`: crea hasta N ejecuciones, máximo inicial 10.

Cada omisión o catch-up queda auditado. Nunca se crean ejecuciones ilimitadas tras una ausencia larga.

### Identidad e idempotencia

Cada ocurrencia tiene:

```text
occurrenceKey = sha256(scheduleId + plannedAt)
requestId = schedule:<scheduleId>:<plannedAt-iso>
```

Crear el job y registrar la ocurrencia debe ocurrir en un commit coordinado. Si no pueden compartir documento/transacción, primero se reserva la ocurrencia y luego se crea el job idempotentemente. Reabrir nunca duplica la misma `plannedAt`.

### Resolución del agente

V1 usa `resolutionPolicy: "snapshot"`:

- al crear schedule se resuelven agente, tools, modelo, thinking, cwd, schema, gates e isolation;
- cada ocurrencia copia ese snapshot;
- editar el archivo de agente no altera schedules existentes.

Una operación humana `refresh` reemplaza el snapshot para ocurrencias futuras y registra hash anterior/nuevo. No cambia jobs ya creados.

### Requisitos funcionales

#### RF-01 — Crear

Requiere nombre de agente, tarea, expresión, zona, misfire y opcionalmente fecha final/cantidad máxima. Los mismos validadores de un spawn normal se ejecutan al crear.

#### RF-02 — Pausar y reanudar schedule

Pausar evita futuras ocurrencias; no pausa jobs ya creados. Reanudar calcula desde el instante actual y aplica política de misfire según `pausedAt` y configuración explícita.

#### RF-03 — Eliminar

Eliminar marca `deleted` y desarma timer. No cancela jobs existentes. El registro se conserva para auditoría y deduplicación.

#### RF-04 — Una sola ejecución

Relativo y absoluto pasan a `completed` después de reservar su única ocurrencia, incluso si el job luego falla. Retry del job usa fase 02; no vuelve a dispararse el schedule.

#### RF-05 — Límites

- máximo 100 schedules activos por sesión;
- frecuencia mínima 10 segundos;
- máximo 10 catch-up por activación;
- tarea máximo igual al spawn normal;
- un timer físico puede representar el próximo deadline; el resto se calcula durablemente.

### Interfaces

#### Comandos

```text
/subagents schedule create <agente> "<tarea>" --at <expr> [--timezone <tz>]
/subagents schedule list
/subagents schedule status <id>
/subagents schedule pause <id>
/subagents schedule resume <id>
/subagents schedule delete <id>
/subagents schedule refresh <id>
```

Crear, refresh y delete requieren confirmación humana en TUI. La tool de modelo puede crear schedules solo si una política explícita lo habilita; predeterminado: deshabilitado.

#### RPC y tool

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

### Modelo persistente

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

### Recuperación

1. abrir documentos;
2. reclamar propiedad de scheduler para la sesión;
3. reconciliar ocurrencias reservadas sin job;
4. calcular misfires;
5. reservar/crear según política y límites;
6. armar próximo timer;
7. emitir `scheduler-ready` con conteos.

Una caída después de reservar y antes de crear usa el mismo requestId. Una caída después de crear y antes de enlazar busca el job por `createdFromOccurrence`.

### Seguridad y autoridad

- El scheduler ejecuta instrucciones futuras con permisos del proceso; creación por modelo está apagada por defecto.
- Schedules de proyecto se crean solo en proyecto confiado.
- No se re-resuelven agentes automáticamente, evitando que una edición posterior amplíe privilegios.
- Ningún schedule aprueba resultados ni promueve ramas.
- La UI muestra próximo disparo, actor, snapshot y política de ausencia.

### Errores

- `SCHEDULE_INVALID_EXPRESSION`
- `SCHEDULE_INVALID_TIMEZONE`
- `SCHEDULE_TOO_FREQUENT`
- `SCHEDULE_LIMIT_EXCEEDED`
- `SCHEDULE_NOT_FOUND`
- `SCHEDULE_MODEL_CREATION_FORBIDDEN`
- `SCHEDULE_SNAPSHOT_INVALID`
- `SCHEDULE_OWNERSHIP_CONFLICT`

### Fuera de alcance

- Daemon o launchd.
- Schedules globales entre sesiones.
- Alta disponibilidad multi-proceso.
- Calendarios externos.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Criterios de aceptación

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

### Pruebas

- Reloj inyectable; sin sleeps reales.
- Cron, intervalos, ISO, DST, zonas inválidas.
- Ausencias largas y límites de catch-up.
- Caídas en reserva, creación y enlace.
- Pausa/reanudación/delete concurrentes con disparo.
- Snapshot y refresh.
- Migración desde fase 07.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Propuesta bloqueada. No hay plan ni tareas aprobados y no se generan en esta migración.
