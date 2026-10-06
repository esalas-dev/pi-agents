# 07 — Steering durable y auditable

## Estado y dependencias

Propuesta. Depende de 01–06, especialmente control durable y outbox de eventos.

## Objetivo

Permitir añadir instrucciones a un trabajo activo sin perderlas ante una caída, conservando orden, actor, entrega y aplicación. Steering redirige trabajo futuro; no modifica retroactivamente efectos ya ejecutados.

## Semántica

Una instrucción de steering atraviesa:

```text
accepted ──▶ queued ──▶ delivering ──▶ applied
                         ├─▶ rejected
                         └─▶ interrupted
```

- `accepted`: validada y persistida.
- `queued`: espera un límite seguro de la conversación.
- `delivering`: Pi Durable recibió el request.
- `applied`: la instrucción entró en el transcript/checkpoint.
- `rejected`: el job no admite steering o terminó antes.
- `interrupted`: no puede determinarse si fue aplicada.

La API no afirma «applied» solo porque se aceptó.

## Spike obligatorio

Antes de implementar se debe comprobar en la API pública de Pi Durable:

- cómo añadir input/steering a una submission activa;
- qué identificador idempotente acepta;
- qué ocurre si el modelo está ejecutando una herramienta;
- cómo observar que el mensaje fue incorporado;
- cómo se reanuda tras cierre.

Si no existe soporte público suficiente, solo se implementará cola durable con estado `blocked_capability`; no se intentará mutar internals ni recrear la conversación.

## Requisitos funcionales

### RF-01 — Crear steering

Entrada:

- job ID;
- mensaje no vacío, máximo 16 KiB;
- requestId;
- actor;
- motivo opcional;
- expectativa opcional de versión (`expectedJobUpdatedAt`) para evitar redirigir un job diferente al observado.

Solo se acepta en `provisioning`, `running`, `pause_requested` o `paused`. Para `queued`, la autoridad debe editar/cancelar y recrear; V1 no altera la tarea capturada.

### RF-02 — Orden

Las instrucciones se procesan FIFO por secuencia durable. No existen prioridades ocultas. Cancelación de trabajo domina y rechaza steering no aplicado.

### RF-03 — Job pausado

Puede aceptar steering mientras está `paused`; permanece `queued` y se entrega después de `resume`, antes de nueva generación. No reanuda implícitamente el job.

### RF-04 — Entrega idempotente

Cada steering usa `requestId = steer:<job-id>:<steering-id>` al interactuar con Pi Durable. Reintentar tras caída consulta transcript/submission antes de duplicarlo.

Si la API no permite confirmar, la reconciliación marca `interrupted` y pide decisión humana; nunca duplica silenciosamente un mensaje que podría haberse aplicado.

### RF-05 — Resultado y auditoría

`status` indica cantidad pendiente/aplicada. La vista humana puede mostrar actor, mensaje e instantes. Tools modelo solo ven mensajes que el mismo actor modelo envió, salvo autorización para evitar filtrar instrucciones humanas privadas.

El resultado terminal referencia conteo e IDs, no copia todos los mensajes.

## Interfaces

### Comando

```text
/pi-agents steer <id> "<mensaje>" [--reason <texto>]
/pi-agents steering <id>
```

El comando requiere confirmación si el job fue creado por otro actor y el mensaje podría cambiar una ejecución con efectos.

### Tool

```json
pi_agents_steer({
  "id": "psa_...",
  "message": "No modifiques la API pública",
  "request_id": "...",
  "expected_updated_at": 0
})
```

Política predeterminada: el modelo solo dirige jobs creados por él mismo. Nunca puede atribuir actor `human`.

### RPC/eventos

RPC `steer`; eventos:

- `job.steering-accepted`
- `job.steering-applied`
- `job.steering-rejected`
- `job.steering-interrupted`

Los eventos no contienen mensaje completo; incluyen ID, actor kind y hash.

## Modelo persistente

Documento separado para evitar crecimiento de `JobRecord`:

```ts
interface SteeringRecord {
  id: string;
  jobId: string;
  sequence: number;
  message: string;
  messageHash: string;
  status: "accepted" | "queued" | "delivering" | "applied" |
    "rejected" | "interrupted" | "blocked_capability";
  actor: Actor;
  requestId: string;
  acceptedAt: number;
  deliveredAt?: number;
  appliedAt?: number;
  error?: string;
}
```

Se limita a 100 instrucciones por job y 1 MiB total. Superar límites retorna error; no se trunca una instrucción.

## Límites seguros

La entrega ocurre después de la herramienta actual y antes de la siguiente llamada de modelo, salvo que Pi Durable documente otra semántica. No interrumpe una escritura o comando a mitad. El usuario debe poder cancelar el job si necesita detener efectos.

## Conflictos

- Dos steerings distintos son FIFO aunque se contradigan.
- Steering y cancel: cancel gana; pendientes quedan `rejected` con razón.
- Steering y finalización: si el terminal se confirma primero, se rechaza.
- Steering y pausa: se acepta pero no se entrega hasta reanudar.
- Mismo requestId/payload: idempotente; payload diferente: conflicto.

## Seguridad y control

- Todo mensaje conserva actor real.
- Las instrucciones humanas no se presentan como producidas por el modelo.
- Steering no aprueba resultado, gate o rama.
- Mensajes pueden contener secretos; eventos solo exponen hash.
- La UI debe advertir que efectos ya ejecutados no se revierten.

## Criterios de aceptación

1. Un steering aceptado antes de cerrar Pi se aplica o queda en estado explícito al reabrir.
2. Dos mensajes se aplican en orden FIFO.
3. Repetir requestId no duplica mensaje en transcript.
4. Steering durante herramienta espera un límite seguro.
5. Pausar no aplica mensajes hasta resume.
6. Cancelar rechaza pendientes.
7. Un modelo no dirige jobs humanos bajo política predeterminada.
8. Eventos no contienen el mensaje.
9. Si la API no confirma entrega, se marca incertidumbre en vez de mentir.
10. El historial sigue consultable después del terminal.

## Pruebas

- Entrega antes/durante/después de turnos y herramientas.
- Cierre en cada estado de steering.
- Orden y duplicados bajo concurrencia.
- Pausa, cancelación y finalización simultáneas.
- Límites de tamaño y cantidad.
- Visibilidad por actor.
- Migración desde fase 06.

## Fuera de alcance

- Editar mensajes ya aplicados.
- Prioridades, borrado o reordenamiento.
- Interrumpir procesos externos a mitad.
- Steering entre sesiones.
