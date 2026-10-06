# 03 — Eventos y RPC versionado

## Estado y dependencias

Propuesta. Depende de consulta y control (01–02).

## Objetivo

Permitir que otras extensiones observen y operen el ejecutor durable sin importar sus módulos internos, con contratos versionados, resultados acotados y semántica explícita ante duplicados.

## Namespace

Para evitar colisiones con `@tintinweb/pi-subagents`, esta implementación usará:

```text
pi-durable-subagents:*
```

No responderá a `subagents:*` ni registrará compatibilidad upstream implícita. Un adaptador futuro deberá ser un paquete separado y declarar qué semántica pierde.

## Principios

- RPC sobre `pi.events` es transporte en proceso, no frontera de seguridad.
- Los eventos son notificaciones; SQLite sigue siendo la fuente de verdad.
- Los consumidores deben tolerar duplicados y consultar el estado actual.
- Los resultados completos no viajan en eventos.
- Todo RPC mutante exige `requestId`.

## Descubrimiento y capacidades

En `session_start`, después de abrir y reconciliar el Harness, se emite:

```json
{
  "protocolVersion": 1,
  "sessionId": "...",
  "capabilities": [
    "query", "wait", "result", "control"
  ],
  "limits": {
    "maxWaitSeconds": 300,
    "maxListPage": 100,
    "maxResultBytes": 65536
  }
}
```

Canal: `pi-durable-subagents:ready`.

RPC `ping` devuelve el mismo documento y una versión de implementación. Las capacidades posteriores (`structured-output`, `groups`, etc.) se añadirán sin cambiar protocolo mientras sean aditivas.

## Sobre RPC

### Solicitud

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "sessionId": "sesión esperada",
  "params": {}
}
```

### Respuesta

```json
{
  "protocolVersion": 1,
  "requestId": "uuid",
  "success": true,
  "data": {}
}
```

O el sobre de error común definido en el índice.

La respuesta se emite en:

```text
pi-durable-subagents:rpc:<operación>:reply:<requestId>
```

Cada listener debe retirarse tras responder. Las solicitudes con versión mayor retornan `PROTOCOL_UNSUPPORTED`.

## Operaciones v1

- `ping`
- `status`
- `list`
- `wait`
- `result`
- `spawn`
- `control`
- `review`

`spawn` reutiliza exactamente `buildStartInput` y `JobManager.start`; no mantiene una ruta de validación paralela. Debe indicar actor `extension` e identificador de caller cuando el transporte lo proporcione. Como `pi.events` no autentica al emisor, ese identificador es declarativo.

`review` solo estará habilitado para RPC si una configuración explícita enumera callers confiables. Predeterminado: deshabilitado. Sin identidad verificable, la extensión no debe aceptar por RPC una aprobación humana.

## Eventos de ciclo de vida

Canales:

- `pi-durable-subagents:job:queued`
- `...:started`
- `...:pause-requested`
- `...:paused`
- `...:resumed`
- `...:cancel-requested`
- `...:cancelled`
- `...:completed`
- `...:failed`
- `...:interrupted`
- `...:reviewed`
- `...:consumed`

Sobre:

```json
{
  "protocolVersion": 1,
  "eventId": "pse_...",
  "sequence": 42,
  "sessionId": "...",
  "jobId": "psa_...",
  "type": "job.completed",
  "occurredAt": 0,
  "data": {
    "status": "completed",
    "agent": "reviewer",
    "hasResult": true
  }
}
```

No incluye tarea, prompt, respuesta, cwd completo, stdout ni secretos. Una configuración de diagnóstico puede añadir rutas, nunca contenido completo.

## Outbox durable

Se añade un documento append-only o cola acotada `EventsDoc`:

```ts
{
  nextSequence: number;
  pending: EventRecord[];
  recent: EventRecord[];
}
```

La transición de job y la creación de su evento deben ocurrir en el mismo commit Durable cuando sea posible. El emisor:

1. lee eventos pendientes;
2. emite en orden de `sequence`;
3. marca `emittedAt` en un commit posterior;
4. mueve el evento a un anillo `recent` acotado.

Una caída entre 2 y 3 duplica el evento. `eventId` y `sequence` permiten deduplicarlo. No se afirma entrega exactamente una vez.

Los eventos pendientes se vuelven a emitir al abrir la misma sesión. No se emiten cuando la sesión no está activa, porque no existe bus de proceso que los reciba.

## Idempotencia RPC

Se mantiene un registro acotado de respuestas mutantes por `requestId`, hash de operación y parámetros. Repetición idéntica retorna la respuesta anterior. Reutilización con parámetros diferentes retorna `REQUEST_ID_CONFLICT`.

Las operaciones de lectura no necesitan persistir cada respuesta, salvo `result consume`, `review`, `spawn` y `control`, que son mutantes.

## Timeouts

- `ping/status/list`: 5 s internos.
- `spawn/control/review`: 30 s para persistir aceptación, no para terminar el trabajo.
- `wait`: límite de la especificación 01.
- El caller es responsable de retirar listeners tras su timeout.

La expiración de RPC no revierte una operación ya persistida; el caller debe repetir con el mismo `requestId`.

## Ciclo de vida

- Los handlers se registran en `session_start`, no al cargar la fábrica.
- En `session_shutdown` se dejan de aceptar solicitudes antes de cerrar el Harness.
- `ready` se emite solo cuando la sesión puede responder.
- Un cambio de sesión invalida el `sessionId` anterior y devuelve `SESSION_MISMATCH`.

## Seguridad

- RPC tiene los permisos del proceso Pi; no se presenta como sandbox.
- `spawn` respeta confianza de proyecto, agentes soportados y política de modelo.
- `result` aplica revisión y truncado de la fase 01.
- `control` aplica propiedad/actor de la fase 02.
- `review` está desactivado para RPC por defecto.
- Los eventos evitan datos sensibles y solo incluyen identificadores opacos.

## Errores adicionales

- `PROTOCOL_UNSUPPORTED`
- `SESSION_MISMATCH`
- `CAPABILITY_UNAVAILABLE`
- `RPC_SHUTTING_DOWN`
- `RPC_REVIEW_FORBIDDEN`
- `CALLER_NOT_ALLOWED`

## Criterios de aceptación

1. `ping` después de `ready` devuelve protocolo, sesión, límites y capacidades.
2. Dos RPC mutantes idénticos con el mismo `requestId` producen un único efecto.
3. Un requestId reutilizado con otro payload falla.
4. Una caída después de emitir y antes de confirmar puede duplicar el evento con el mismo `eventId`.
5. Al reabrir se reemiten eventos pendientes en orden.
6. Ningún evento terminal contiene el resultado completo.
7. `result` vía RPC bloquea resultados pendientes de revisión.
8. `review` RPC está prohibido con configuración predeterminada.
9. Un handler no responde después de `session_shutdown`.
10. Instalar upstream y local simultáneamente no produce colisión de canales.

## Pruebas

- Contratos JSON y compatibilidad de campos aditivos.
- Carreras de timeout/respuesta y doble listener.
- Outbox antes/después de cada commit.
- Fuzz de requests malformados y versiones desconocidas.
- Verificación de redacción de eventos.
- Integración con una extensión caller ficticia.
- Migración desde fase 02.

## Documentación

Crear una referencia RPC independiente con tabla de operaciones, capacidades, eventos, códigos de error y ejemplo de deduplicación. El README solo debe resumir y enlazarla.
