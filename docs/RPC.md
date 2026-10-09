# API pública RPC v1

RPC permite que otras extensiones del mismo proceso Pi consulten y operen jobs mediante `pi.events`, sin importar módulos internos. Es un transporte local entre extensiones, **no una frontera de seguridad**: `callerId` es declarativo y otra extensión puede suplantarlo. No hay autenticación entre procesos ni compatibilidad implícita con el namespace upstream `subagents:*`.

## Descubrimiento

El servidor emite `pi-durable-subagents:ready` después de abrir la sesión y registrar sus handlers. Un consumidor tardío no depende de haber visto ese evento: crea el cliente y llama `ping`.

```ts
import { createRpcClient } from "./rpc.ts";

const rpc = createRpcClient({ bus: pi.events, callerId: "mi-extension" });
const discovery = await rpc.call("ping", {}, { requestId: "mi-extension:ping:1" });
if (!discovery.success) throw new Error(discovery.error.code);
const status = await rpc.call("status", { id: "psa_ejemplo" }, { requestId: "mi-extension:status:1" });
rpc.close();
```

Un `ping` exitoso sin `sessionId` fija la sesión descubierta para las llamadas siguientes. Se puede crear el cliente con un `sessionId` conocido para fijarlo explícitamente. Una respuesta de otra sesión se ignora, excepto un error `SESSION_MISMATCH` válido y correlacionado, que se entrega como `RpcResponse` sin cambiar la sesión del cliente ni reenviar la solicitud. Para redescubrir tras un cambio, el caller crea un cliente nuevo sin `sessionId` y ejecuta `ping`.

## Transporte y sobres

- Solicitud: `pi-durable-subagents:rpc:<operación>`.
- Respuesta: `pi-durable-subagents:rpc:<operación>:reply:<correlationId>`.
- `ready`: `pi-durable-subagents:ready`.

La solicitud contiene `protocolVersion: 1`, `requestId`, `correlationId`, `callerId`, `params` y `sessionId` (opcional únicamente para `ping`). La respuesta contiene protocolo, `requestId`, `correlationId`, `sessionId` y exactamente uno de `data` o `error` según `success`.

El cliente instala el listener antes de emitir, valida la respuesta completa y solo acepta la operación/correlación/solicitud/sesión esperada. La única excepción de sesión es un error `SESSION_MISMATCH` válido, con operación, correlación y requestId esperados: completa la llamada sin redirección. Respuestas malformadas o ajenas no completan la llamada. Cada intento conserva el requestId capturado al enviarse, aunque el caller modifique o reutilice su objeto de opciones; esto no permite reutilizar una intención durable con otro payload. El listener y timer se retiran tras respuesta, timeout local, error de transporte o `close()`.

Los identificadores `requestId`, `callerId` y `sessionId` son strings no vacíos con máximo de 256 bytes UTF-8. `correlationId` tiene entre 1 y 128 caracteres ASCII de `[A-Za-z0-9._-]`, pues forma parte del canal de respuesta. `pi.events` transporta objetos: no construyas JSON concatenando strings ni interpolando parámetros en canales. El texto de resultado se mide y trunca por bytes UTF-8; no se corta dentro de un par sustituto Unicode. El límite de 65536 bytes incluye el sobre JSON serializado y sus escapes.

El RPC client rechaza errores locales con `RpcClientError`, separados del sobre `RpcResponse`: `RPC_CLIENT_TIMEOUT`, `RPC_CLIENT_CLOSED`, `RPC_CLIENT_TRANSPORT`, `RPC_CLIENT_SESSION_REQUIRED` o `RPC_CLIENT_INVALID_OPTIONS`. Un timeout local no prueba que el servidor no haya persistido la mutación.

## Operaciones

| Operación | Parámetros | Respuesta / efecto |
|---|---|---|
| `ping` | `{}` | `RpcDiscovery`: sesión, versión, operaciones, capacidades y límites. No necesita sesión previa. |
| `status` | `{ id }` | `RpcJobDto` compacto; no lee cuerpo de resultado. |
| `list` | Filtros de estado/agente/fechas/revisión, `limit` y `cursor` | Página de `RpcJobDto` (máximo 100) y cursor opaco opcional. |
| `wait` | `{ id, until?, timeoutSeconds? }` | `RpcJobDto` al cumplir el predicado; máximo 300 segundos. Timeout termina la espera, no el job. |
| `result` | `{ id, operation: "peek" | "consume" }` | Job y resultado autorizado. `consume` es mutante/idempotente por `requestId`. |
| `spawn` | `{ agent, task }` | Recibo `{ jobId, status: "queued", agent }`; no espera generación. Usa cwd y confianza de la sesión activa. |
| `control` | `{ id, action, reason? }` | Recibo durable para `pause`, `resume`, `cancel` o `retry`, sujeto a política y propiedad existentes. |
| `review` | `{}` | Siempre `RPC_REVIEW_FORBIDDEN`; el caller extension no recibe autoridad TUI ni parental. |

Las vistas de status/list/wait son allowlists; no exponen task, prompt, cwd, rutas, errores internos ni actor. Los resultados `pending` o `rejected` no se revelan. `result` limita el sobre completo a 65536 bytes, devuelve `totalBytes`, SHA-256 del texto completo y `truncated`; el cuerpo completo no aparece en otro campo. `provisioning` se presenta como `running`.

### Errores del servidor

Los errores del servidor tienen `{ code, message, retryable, details }`; los mensajes RPC se sanitizan y `details` es vacío. Códigos: `JOB_NOT_FOUND`, `INVALID_REQUEST`, `AGENT_NOT_FOUND`, `UNSUPPORTED_TOOLS`, `MODEL_UNAVAILABLE`, `REQUEST_ID_CONFLICT`, `RUNTIME_CLOSING`, `MIGRATION_REQUIRED`, `MIGRATION_DECLINED`, `BACKUP_FAILED`, `STORAGE_VERSION_UNSUPPORTED`, `STORAGE_INCONSISTENT`, `STORAGE_BUSY`, `STORAGE_ERROR`, `INVALID_FILTER`, `WAIT_TIMEOUT`, `WAIT_ABORTED`, `RESULT_NOT_READY`, `RESULT_REVIEW_REQUIRED`, `RESULT_REJECTED`, `PAUSE_ACTIVE_UNSUPPORTED`, `CONTROL_INVALID_STATE`, `CONTROL_NOT_AUTHORIZED`, `RETRY_NOT_ALLOWED`, `PROTOCOL_UNSUPPORTED`, `SESSION_MISMATCH`, `CAPABILITY_UNAVAILABLE`, `RPC_SHUTTING_DOWN`, `RPC_REVIEW_FORBIDDEN` y `RPC_TIMEOUT`.

Los IDs sobredimensionados o una correlación insegura se descartan sin generar respuesta en un canal arbitrario. `SESSION_MISMATCH` no autoriza al cliente a redirigirse.

## Deadlines e idempotencia

El cliente usa por defecto 6000 ms para consultas (`ping`, `status`, `list`, `result peek`), 31000 ms para mutaciones (`spawn`, `control`, `result consume`) y `(timeoutSeconds ?? 300) * 1000 + 1000` para `wait`. El servidor aplica 5000 ms a consultas, 30000 ms a aceptación de mutaciones y hasta 300 segundos a wait. `timeoutMs` puede configurarse por llamada.

No hay reintento automático. Si el resultado de una mutación queda incierto por timeout, repite manualmente la misma intención con el mismo `requestId` y una correlación nueva. No reutilices ese ID con otro payload, operación o actor: el ledger durable deduplica mutaciones y rechaza conflictos. Las consultas y `result peek` no persisten cada respuesta. El `requestId` no incluye `correlationId` ni el deadline de transporte.

## Eventos y reconciliación

Los eventos llevan `protocolVersion`, `eventId`, `sequence`, `sessionId`, `jobId`, `type`, `occurredAt` y `data` de allowlist. Los tipos actuales son `job.queued`, `job.provisioning`, `job.started`, `job.paused`, `job.resumed`, `job.cancel-requested`, `job.cancelled`, `job.completed`, `job.failed`, `job.interrupted`, `job.reviewed` y `job.consumed`. No existe `pause-requested` porque la pausa activa no está soportada.

La mutación y el registro durable del evento son atómicos. El emisor ordena por secuencia, pero una caída después de emitir y antes de confirmar puede producir duplicados con el mismo `(sessionId, eventId)`. No hay acuse de procesamiento, garantía de entrega exactamente una vez, replay completo a consumidores tardíos ni GC física automática. La ventana reciente indexa hasta 1000 referencias de eventos emitidos; esto no limita los documentos históricos almacenados. Los eventos no incluyen tareas, prompts, texto de resultados, cwd, rutas, stdout ni motivos libres. `job.reviewed` también cubre la revisión parental nativa autorizada y la toma de autoridad humana aun con el mismo status; no publica padre/actor/requestId. Replay y no-op no emiten otro evento.

Un consumidor debe deduplicar por `(sessionId, eventId)` y consultar `status`/`list` para reconciliar. La separación de `pi-durable-subagents:*` frente a `subagents:*` garantiza solo aislamiento de nombres probado localmente; no afirma convivencia de runtime con upstream.

## Autoridad y límites

El servidor siempre deriva `{ kind: "extension", id: callerId }`; el caller no puede elegir actor, cwd, consentimiento, tools o credenciales. El `callerId` no está autenticado y no debe tratarse como prueba de identidad. `spawn` usa el cwd, confianza del proyecto, agentes y modelos de la sesión activa. Cancelar un job activo requiere UI TUI y confirmación humana; en modo headless responde `CAPABILITY_UNAVAILABLE`. Pausar un job activo responde `PAUSE_ACTIVE_UNSUPPORTED`.

El caller de ejemplo está en [`tests/fixtures/rpc-caller-extension.ts`](../tests/fixtures/rpc-caller-extension.ts); la cobertura SQLite/runtime del flujo está en [`tests/rpc-integration.test.mjs`](../tests/rpc-integration.test.mjs). No es una extensión de producción ni evidencia de compatibilidad upstream.
