# 02 — Control durable del ciclo de vida

## Estado y dependencias

Propuesta. Depende de la especificación 01 para consulta, actores, `requestId` y errores.

## Objetivo

Permitir que una autoridad solicite cancelar, pausar, reanudar o reintentar trabajos, conservando la intención y su resultado a través de cierres del proceso.

## Decisiones principales

- Las solicitudes se persisten antes de actuar.
- «Pausar» significa no iniciar nuevo trabajo de modelo/herramienta después de un límite seguro; no promete congelar un proceso en cualquier instrucción.
- «Cancelar» es cooperativo por defecto. No se mata el proceso Pi.
- «Retry» crea un nuevo trabajo enlazado y deja inmutable el trabajo original.
- El aborto de una espera nunca se interpreta como cancelación.

## Estados públicos

Se añaden:

```text
paused
cancelling
cancelled
```

Estados internos adicionales permitidos:

```text
pause_requested
resume_requested
cancel_requested
```

La representación pública puede mapear `pause_requested` a `running` con `control.pending = "pause"`, pero el estado interno debe permanecer observable para diagnóstico.

## Máquina de estados

```text
queued ──pause──▶ paused ──resume──▶ queued
queued ──cancel─▶ cancelled

provisioning/running ──pause──▶ pause_requested ──checkpoint seguro──▶ paused
pause_requested ──resume──▶ running              (retira solicitud aún no aplicada)

provisioning/running/paused ──cancel──▶ cancel_requested/cancelling
cancel_requested ──confirmación Durable──▶ cancelled

completed/failed/interrupted/cancelled ──retry──▶ nuevo job queued
```

No se permite reanudar `completed`, `failed`, `interrupted` o `cancelled`. Se usa `retry`.

## Requisitos funcionales

### RF-01 — Operación de control idempotente

Toda operación recibe:

- `jobId`;
- `action`;
- `requestId` obligatorio en tools/RPC y generado por el comando;
- actor;
- motivo opcional, máximo 2 KiB.

La respuesta incluye estado previo, estado resultante y si la petición ya existía.

### RF-02 — Pausa de jobs en cola

Un job `queued` pasa a `paused` en un solo commit y se elimina de `queue`. Se conserva `queueOrdinal` o equivalente para que `resume` lo reinserte de forma determinista. La política predeterminada será volver al final de la cola; una futura política de prioridad queda fuera de alcance.

### RF-03 — Pausa de jobs activos

Antes de implementar debe realizarse un spike contra la API pública de Pi Durable para determinar si existe:

- pausa de submission;
- steering a un límite seguro;
- o cancelación reanudable desde checkpoint.

Si no existe soporte público, la pausa activa debe declararse no soportada con `PAUSE_ACTIVE_UNSUPPORTED`; no se simulará dejando un booleano mientras la generación continúa.

Una pausa aceptada se considera aplicada solo cuando el scheduler Durable confirma que no habrá más efectos hasta `resume`.

### RF-04 — Cancelación

- `queued` y `paused` sin submission activa se cancelan atómicamente.
- Para activos se persiste la intención y luego se solicita aborto a Pi Durable.
- Si una herramienta insegura queda en estado incierto, el resultado será `interrupted`, no `cancelled`, con detalle de la incertidumbre.
- Una cancelación terminal conserva transcript, metadatos y resultado parcial disponible.

### RF-05 — Reanudación

`resume` retira una pausa aplicada y recoloca el job en cola o reanuda su submission según su estado Durable. Debe reutilizar conversation y submission existentes cuando la API lo permita; no crea una segunda conversación silenciosamente.

### RF-06 — Retry

`retry` solo acepta estados terminales. Crea un nuevo ID con:

- `retryOf` apuntando al trabajo anterior;
- `attemptNumber = anterior.attemptNumber + 1`;
- snapshot original de agente, tarea, cwd, modelo, thinking y futura configuración de gate/worktree;
- revisión nueva `pending` o `not_required` según el actor que solicita;
- sin copiar resultado, consumo ni notificación.

Por defecto usa el snapshot original, no vuelve a leer el archivo de agente. Una opción humana futura `--refresh-agent` puede volver a resolverlo, pero queda fuera de esta fase.

### RF-07 — Historial de control

Cada trabajo mantiene un historial acotado o documento asociado con:

- operación;
- actor;
- requestId;
- instante solicitado/aplicado;
- estado anterior/posterior;
- resultado y error.

No se sobrescriben solicitudes previas.

## Interfaces

### Comandos

```text
/pi-agents cancel <id> [--reason <texto>]
/pi-agents pause <id> [--reason <texto>]
/pi-agents resume <id> [--reason <texto>]
/pi-agents retry <id> [--reason <texto>]
```

`cancel` sobre un job activo requiere confirmación interactiva cuando hay TUI. En modo no interactivo exige `--yes`.

### Tool

```json
pi_agents_control({
  "id": "psa_...",
  "action": "cancel | pause | resume | retry",
  "request_id": "...",
  "reason": "..."
})
```

Una política configurable puede prohibir que el modelo cancele, reanude o reintente trabajos creados por humanos. Predeterminado: el modelo solo controla trabajos creados por el mismo modelo en la sesión.

## Modelo persistente

```ts
control?: {
  pending?: "pause" | "resume" | "cancel";
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

El historial en el registro se limita por tamaño. Si supera 64 KiB se mueve a un documento append-only enlazado.

## Reconciliación tras caída

| Ventana | Reconciliación |
|---|---|
| Intención persistida, efecto no solicitado | El reconciliador vuelve a solicitarlo con el mismo `requestId`. |
| Efecto aplicado, confirmación local ausente | Consulta el estado Durable antes de repetir. |
| Cancelación durante herramienta insegura | Marca `interrupted` y exige decisión explícita de retry. |
| Retry creado, respuesta al caller perdida | Repetir `requestId` devuelve el nuevo job ya creado. |
| Job pausado al cerrar | Permanece pausado al reabrir; el pump no lo admite. |

## Conflictos

- `cancel` domina `pause` y `resume` pendientes.
- `pause` repetido es éxito idempotente.
- `resume` sobre job no pausado devuelve `INVALID_STATE`, salvo que retire una pausa aún no aplicada.
- Dos retries con requestIds distintos crean dos intentos deliberados y deben advertirse en UI.
- Una operación sobre un job terminal nunca reescribe el terminal.

## Seguridad y autoridad

- Cancelar no borra evidencia.
- Retry no implica aprobación del intento anterior.
- Resultado parcial de cancelación queda pendiente de revisión.
- Motivos y actores son auditables y no pueden ser aportados por el agente ejecutor como si fueran humanos.
- No existe `force kill` del proceso en esta fase.

## Criterios de aceptación

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

## Pruebas

- Tabla completa de transiciones válidas e inválidas.
- Carreras `pause/resume`, `pause/cancel`, `retry/retry`.
- Cierre en cada ventana de reconciliación.
- Aborto durante modelo, herramienta segura y herramienta insegura.
- Idempotencia de requests y conflicto de payload.
- Migración desde documento de la fase 01.

## Cambios documentales

README debe distinguir `cancelled` de `interrupted` y explicar que una pausa activa depende de soporte público de Pi Durable. Arquitectura debe incorporar el reconciliador de control y la prioridad de cancelación.
