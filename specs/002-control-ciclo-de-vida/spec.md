# Feature Specification: Control durable del ciclo de vida

**Feature Branch**: `002-control-ciclo-de-vida` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: completada según roadmap e informe de aceptación

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/02-control-ciclo-de-vida.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Controlar un trabajo sin perder intención ni historial (Priority: P1)

Cancelar, pausar/reanudar la cola y reintentar trabajos mediante intención durable y autoridad separada.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** una autoridad solicita control y se reabre la sesión tras una caída,
   **Then** la intención se reconcilia sin duplicados y la incertidumbre no se presenta como cancelled.
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
- **Estado de autorización**: Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE persistir control e historial con requestId antes de efectos y deduplicar replays.
- **FR-002**: El sistema DEBE permitir pausa/reanudación de cola y responder PAUSE_ACTIVE_UNSUPPORTED para pausa activa.
- **FR-003**: El sistema DEBE confirmar cancelación activa durablemente; retry crea otro job enlazado y conserva el original.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- Job original y nuevo job de retry mantienen lineage sin mutación retrospectiva.
- Intención, recibo e historial de control relacionan requestId, actor y confirmación.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Objetivo

Permitir que una autoridad solicite cancelar, pausar, reanudar o reintentar trabajos, conservando la intención y su resultado a través de cierres del proceso.

#### Spike de APIs públicas

El entorno objetivo expone `@earendil-works/pi-durable` `1.0.1`. La inspección directa de `README.md` y `dist/**/*.d.ts` confirmó `Submission.abort()`, `Conversation.abort()`, `Harness.abortSubmission()`, `Harness.abortTask()`, `Harness.resume()`, `Harness.submission()` e `Harness.inspect()`. `whenBusy: "steer"` es steering de entradas, no una pausa de la generación. No se observó una API pública genérica de pausa/reanudación de una generación activa.

Decisión: la pausa activa responde `PAUSE_ACTIVE_UNSUPPORTED`; no se simula con flags. La cancelación activa es cooperativa y usa únicamente las APIs públicas confirmadas.

#### Versionado de almacenamiento

La fase incrementa el almacenamiento de esquema 3 a esquema 4. La migración 3→4 es explícita, exige backup y autorización humana, conserva jobs, resultados, revisiones, consumos y ledger, e inicializa los campos de control e historial sin abrir el Harness mientras la base siga en esquema 3.

### Decisiones principales

- Las solicitudes se persisten antes de actuar.
- «Pausar» significa no iniciar nuevo trabajo de modelo/herramienta después de un límite seguro; no promete congelar un proceso en cualquier instrucción.
- «Cancelar» es cooperativo por defecto. No se mata el proceso Pi.
- «Retry» crea un nuevo trabajo enlazado y deja inmutable el trabajo original.
- El aborto de una espera nunca se interpreta como cancelación.

### Estados públicos

Se añaden:

```text
paused
cancelling
cancelled
```

Estado interno adicional permitido:

```text
cancel_requested
```

La intención de cancelación debe permanecer observable mediante `control.pending = "cancel"` hasta que el reconciliador confirme el efecto. Las pausas y reanudaciones de jobs en cola son commits atómicos y no dejan una solicitud pendiente.

### Máquina de estados

```text
queued ──pause──▶ paused ──resume──▶ queued
queued ──cancel─▶ cancelled

provisioning/running ──pause──▶ PAUSE_ACTIVE_UNSUPPORTED

provisioning/running/paused ──cancel──▶ cancel_requested/cancelling
cancel_requested ──confirmación Durable──▶ cancelled

completed/failed/interrupted/cancelled ──retry──▶ nuevo job queued
```

No se permite reanudar `completed`, `failed`, `interrupted` o `cancelled`. Se usa `retry`.

### Requisitos funcionales

#### RF-01 — Operación de control idempotente

Toda operación recibe:

- `jobId`;
- `action`;
- `requestId` obligatorio en tools/RPC y generado por el comando;
- actor;
- motivo opcional, máximo 2 KiB.

La respuesta incluye estado previo, estado resultante y si la petición ya existía. El ledger durable registra la operación `control`, el hash canónico y el recibo; repetir el mismo `requestId` devuelve el recibo original y cambiar su payload produce `CONTROL_CONFLICT`.

#### RF-02 — Pausa de jobs en cola

Un job `queued` pasa a `paused` en un solo commit y se elimina de `queue`. Se conserva `queueOrdinal` o equivalente para que `resume` lo reinserte de forma determinista. La política predeterminada será volver al final de la cola; una futura política de prioridad queda fuera de alcance.

#### RF-03 — Pausa de jobs activos

El spike contra Pi Durable `1.0.1` no encontró una pausa pública de submission, conversación o generación. `whenBusy: "steer"` solo inserta una entrada en un límite de turno y no congela la ejecución.

Por tanto, `pause` sobre `provisioning` o `running` falla con `PAUSE_ACTIVE_UNSUPPORTED` sin persistir una falsa pausa. La fase solo implementa pausa de jobs en cola y reanudación de jobs pausados en cola.

#### RF-04 — Cancelación

- `queued` y `paused` sin submission activa se cancelan atómicamente.
- Para activos se persiste la intención y luego se solicita aborto a Pi Durable.
- Si una herramienta insegura queda en estado incierto, el resultado será `interrupted`, no `cancelled`, con detalle de la incertidumbre.
- Una cancelación terminal conserva transcript, metadatos y resultado parcial disponible.

#### RF-05 — Reanudación

`resume` solo acepta un job `paused` sin submission activa y lo recoloca al final de la cola. No reanuda una generación activa ni crea una segunda conversación silenciosamente. Si una pausa activa no está soportada, el job nunca alcanza `paused` por esa ruta.

#### RF-06 — Retry

`retry` solo acepta estados terminales. Crea un nuevo ID con:

- `retryOf` apuntando al trabajo anterior;
- `attemptNumber = anterior.attemptNumber + 1`;
- snapshot original de agente, tarea, cwd, modelo, thinking y futura configuración de gate/worktree;
- revisión nueva `pending` o `not_required` según el actor que solicita;
- sin copiar resultado, consumo ni notificación.

Por defecto usa el snapshot original, no vuelve a leer el archivo de agente. Una opción humana futura `--refresh-agent` puede volver a resolverlo, pero queda fuera de esta fase.

#### RF-07 — Historial de control

Cada trabajo mantiene un historial acotado o documento asociado con:

- operación;
- actor;
- requestId;
- instante solicitado/aplicado;
- estado anterior/posterior;
- resultado y error.

No se sobrescriben solicitudes previas.

### Interfaces

#### Comandos

```text
/subagents cancel <id> [--reason <texto>] [--yes]
/subagents pause <id> [--reason <texto>]
/subagents resume <id> [--reason <texto>]
/subagents retry <id> [--reason <texto>]
```

`cancel` sobre un job activo requiere confirmación interactiva cuando hay TUI. En modo no interactivo exige `--yes`.

#### Tool

```json
pi_agents_control({
  "id": "psa_...",
  "action": "cancel | pause | resume | retry",
  "request_id": "...",
  "reason": "..."
})
```

Una política configurable puede prohibir que el modelo cancele, reanude o reintente trabajos creados por humanos. Predeterminado: el modelo solo controla trabajos creados por el mismo modelo en la sesión.

### Modelo persistente

```ts
control?: {
  pending?: "cancel";
  requestedAt?: number;
  requestedBy?: Actor;
  requestId?: string;
};
retryOf?: string;
attemptNumber?: number;
rootAttemptId?: string;
queueOrdinal?: number;
controlHistory?: ControlEvent[];
```

El historial en el registro se limita por tamaño. Si supera 64 KiB se mueve a un documento append-only enlazado. La intención se persiste antes de invocar cualquier aborto Durable.

### Reconciliación tras caída

| Ventana | Reconciliación |
|---|---|
| Intención persistida, efecto no solicitado | El reconciliador vuelve a solicitarlo con el mismo `requestId`. |
| Efecto aplicado, confirmación local ausente | Consulta el estado Durable antes de repetir. |
| Cancelación durante herramienta insegura | Marca `interrupted` y exige decisión explícita de retry. |
| Retry creado, respuesta al caller perdida | Repetir `requestId` devuelve el nuevo job ya creado. |
| Job pausado al cerrar | Permanece pausado al reabrir; el pump no lo admite. |

### Conflictos

- Un commit de `cancel` gana frente a un commit concurrente de `pause` o `resume`.
- `pause` repetido es éxito idempotente.
- `resume` sobre job no pausado devuelve `CONTROL_INVALID_STATE`.
- Dos retries con requestIds distintos crean dos intentos deliberados y deben advertirse en UI.
- Una operación sobre un job terminal nunca reescribe el terminal.

### Errores de control

- `PAUSE_ACTIVE_UNSUPPORTED`
- `CONTROL_INVALID_STATE`
- `CONTROL_NOT_AUTHORIZED`
- `CONTROL_CONFLICT`
- `RETRY_NOT_ALLOWED`

### Seguridad y autoridad

- Cancelar no borra evidencia.
- Retry no implica aprobación del intento anterior.
- Resultado parcial de cancelación queda pendiente de revisión.
- Motivos y actores son auditables y no pueden ser aportados por el agente ejecutor como si fueran humanos.
- No existe `force kill` del proceso en esta fase.

### Cambios documentales

README debe distinguir `cancelled` de `interrupted` y explicar que una pausa activa depende de soporte público de Pi Durable. Arquitectura debe incorporar el reconciliador de control y la prioridad de cancelación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Criterios de aceptación

1. Pausar un job en cola evita que el pump lo seleccione incluso tras reapertura.
2. Reanudarlo lo devuelve al final de la cola una sola vez.
3. Cancelar un job en cola produce `cancelled` sin conversación nueva.
4. Cancelar un job activo persiste primero la intención.
5. Una herramienta insegura incierta termina `interrupted`, nunca falsamente `cancelled`.
6. Retry conserva el original y devuelve un nuevo ID enlazado.
7. Repetir cada acción con el mismo `requestId` no duplica efectos.
8. Conflictos concurrentes aplican la precedencia documentada.
9. El modelo no puede controlar trabajos humanos bajo la política predeterminada.
10. Si Pi Durable no soporta pausa activa, la función falla explícitamente y las demás operaciones siguen disponibles.

### Pruebas

- Tabla completa de transiciones válidas e inválidas.
- Carreras `pause/resume`, `pause/cancel`, `retry/retry`.
- Cierre en cada ventana de reconciliación.
- Aborto durante modelo, herramienta segura y herramienta insegura.
- Idempotencia de requests y conflicto de payload.
- Migración desde documento de la fase 01.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.
