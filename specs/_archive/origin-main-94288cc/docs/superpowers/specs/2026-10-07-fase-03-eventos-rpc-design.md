# Diseño de fase 03 — Eventos y RPC versionado

## Estado y autoridad del documento

**Diseño conversacional y documento escrito aprobados humanamente.** Fecha: 2026-10-07 UTC. El usuario aprobó explícitamente el documento versionado en `e0d0a99`. Esta aprobación habilita la elaboración del plan, no la implementación, instalación de dependencias ni migraciones reales. El plan requerirá revisión y elección humana del método de ejecución.

Este documento refina y, para fase 03, sustituye los puntos incompatibles de la propuesta [`specs/03-eventos-rpc.md`](../../../specs/03-eventos-rpc.md): ledger RPC acotado, aprobación RPC por allowlist, `pause-requested`, limpieza del handler servidor por respuesta y atomicidad opcional. Los contratos no modificados de fases anteriores conservan su autoridad. La enmienda solicitada el 2026-10-08 a la especificación 01 habilita lectura/entrega al padre verificado; no modifica el contrato de resultados expuestos por RPC.

Base examinada: `main` en `f87d77eba4ba99129a8b9bef6b576cec1309e05a`, con fase 02 cerrada por aprobación humana y PR #4/#5 fusionados. Entorno comprobado: macOS arm64, Node `26.10.0`, host Pi detectado actualmente `1.1.0`, Pi Durable `1.0.1` y Chord `1.0.1`. La resolución valida la versión instalada y la alineación de sus peers; no se promete compatibilidad histórica ni con todas las versiones posteriores.

## 1. Intención y alcance acordados

Permitir que **extensiones locales de confianza** observen y operen subagentes mediante contratos públicos, sin importar módulos internos. Éxito significa reutilizar servicios de dominio, conservar idempotencia tras reapertura, persistir eventos junto con los cambios que describen y evitar exposición de contenido sensible.

Aprobaciones conversacionales explícitas: arquitectura y autoridad; persistencia y recuperación; contrato y lifecycle; mapeo de eventos y pruebas. La aprobación del documento escrito se obtuvo por separado, después de su revisión.

### Incluido

- RPC v1 sobre `pi.events`, descubrimiento y capacidades.
- `ping`, `status`, `list`, `wait`, `result`, `spawn` y `control`.
- Rechazo explícito de `review` RPC, sin allowlist que lo habilite.
- Outbox transaccional por sesión, eventos separados e índices paginados.
- Migración humana del esquema 4 al 5, con backup.
- Referencia RPC, extensión caller de pruebas y gates de aceptación.

### Excluido

Broker externo, autenticación entre procesos, sandbox, aprobaciones RPC, pausa activa, logs en vivo, nuevos mecanismos de steering, grupos, structured output, scheduling y workflows. No se implementará un endpoint de reproducción histórica de eventos en esta fase. No habrá limpieza física automática de documentos históricos ni promesa de almacenamiento total acotado.

## 2. Arquitectura y frontera de autoridad

Se elige **RPC fino + outbox transaccional**. Los eventos volátiles incumplen la recuperación; un broker externo autenticado excede el uso elegido.

| Unidad | Responsabilidad | Dependencias y frontera |
| --- | --- | --- |
| Contratos RPC | Validar solicitudes/respuestas y proyectar DTO públicos | Tipos de dominio; sin abrir recursos |
| Adaptador RPC | Canales, correlación, deadlines y generación activa | Bus público y servicios; no transiciones Durable |
| `JobsService` y servicios de aplicación | Admisión, consulta, espera, acceso a resultados y control | Repositorio y políticas existentes |
| Repositorio + escritor de eventos | Mutación, ledger y evento en el mismo commit | `Tx` público de Pi Durable |
| Repositorio de outbox | Pendientes, secuencia y confirmación de emisión | Documentos Durable, sin conocer el bus |
| Emisor de outbox | Emisión ordenada de la sesión activa | Bus y repositorio de outbox; un único emisor |
| Propietario de runtime | Apertura, reconciliación, sellado y cierre | Lease, Harness, listeners, esperas y emisor |

Los nombres anteriores definen responsabilidades, no un árbol de archivos ya implementado. El plan decidirá la distribución concreta. La extracción del lifecycle de `register.ts` debe limitarse a lo necesario para compartir el runtime y controlar sus generaciones; no se incluye una refactorización global.

El adaptador construye siempre `{ kind: "extension", id: callerId }`. Un caller no puede aportar `human`, `model`, `system`, una marca de confirmación ni una política de autorización. `callerId` es declarativo: otra extensión cargada puede suplantarlo. La propiedad lógica de jobs evita usos accidentales entre callers cooperativos, **no autentica identidad**.

`review` RPC responde `RPC_REVIEW_FORBIDDEN`, incluso si una configuración enumera callers. RPC no concede autoridad de revisión. Fuera de RPC se conservan la TUI humana y la revisión parental nativa de hijos propios definida en la [spec parental](2026-10-07-aprobacion-padre-design.md), integrada por autorización humana del PR #10 el 2026-10-09: actor model, nunca human, y precedencia humana. RPC no puede habilitar migraciones ni promover cambios Git.

## 3. Transporte y contratos públicos

### 3.1 Namespace

Se mantiene el namespace propuesto durante el diseño: `pi-durable-subagents:*`. No se registran canales `subagents:*` ni compatibilidad implícita con `@tintinweb/pi-subagents`. Esto separa nombres, no demuestra seguridad o compatibilidad upstream completa.

- Solicitud: `pi-durable-subagents:rpc:<operacion>`.
- Respuesta: `pi-durable-subagents:rpc:<operacion>:reply:<correlationId>`.
- Descubrimiento: `pi-durable-subagents:ready`.
- Eventos: `pi-durable-subagents:job:<nombre>`, como `job:completed`.

### 3.2 Sobre

Solicitud ilustrativa para `status`:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
  "correlationId": "call-001",
  "sessionId": "sesion-esperada",
  "callerId": "extension-ejemplo",
  "params": { "id": "psa_ejemplo" }
}
```

Respuesta exitosa:

```json
{
  "protocolVersion": 1,
  "requestId": "req-001",
  "correlationId": "call-001",
  "sessionId": "sesion-esperada",
  "success": true,
  "data": { "id": "psa_ejemplo", "status": "queued", "hasResult": false }
}
```

Error: mismos campos de correlación y sesión, `success: false` y `error: { code, message, retryable, details }`, sin `data`. Los ejemplos muestran estructura, no todas las propiedades de cada DTO.

`requestId` identifica la intención durable; `correlationId` identifica un intento de transporte. Al repetir una mutación se conserva `requestId` y se genera otro `correlationId`. No se admiten solicitudes concurrentes con la misma correlación dentro de la generación activa: el duplicado se descarta antes de iniciar otro efecto y se informa localmente, sin emitir una segunda respuesta en el canal del intento original. El caller instala el listener antes de emitir y verifica operación, correlación, solicitud y sesión en la respuesta.

Todos los sobres se validan en runtime. IDs son strings no vacíos; `requestId`, `callerId` y `sessionId` tienen un máximo de 256 bytes UTF-8 cada uno. `correlationId` debe ser seguro para interpolar en un canal, con caracteres ASCII alfanuméricos, punto, guion y guion bajo y máximo 128 caracteres. Los sobres con IDs que excedan estos límites se descartan antes de ejecutar, sin reflejar el ID inválido en una respuesta ni volcar el contenido en logs. Esta precisión fue aprobada humanamente durante la planificación el 2026-10-07 para preservar el presupuesto del sobre. `sessionId`, `requestId` y `callerId` no se interpolan en canales. No se aceptan funciones, valores no JSON, referencias circulares ni campos de autoridad. Parámetros desconocidos se rechazan; los campos informativos opcionales nuevos de respuestas pueden ignorarse para compatibilidad aditiva.

Únicamente se admite `protocolVersion: 1`: versiones diferentes responden `PROTOCOL_UNSUPPORTED`. Si un sobre malformado no contiene correlación segura, no se genera un canal arbitrario para contestarlo; se informa localmente sin volcar el payload. No se replica la solicitud en logs o errores.

### 3.3 Operaciones

| Operación | Parámetros | Semántica |
| --- | --- | --- |
| `ping` | Objeto vacío; `sessionId` puede omitirse | Descubre sesión, versión de implementación, capacidades y límites |
| `status` | `id` | Consulta compacta sin materializar cuerpo del resultado |
| `list` | Filtros de fase 01: estados, agente, fechas, revisión pendiente, límite y cursor | Máximo 100 jobs, cursor opaco; orden de fase 01 |
| `wait` | `id`, `until?`, `timeoutSeconds?` | Predicado público o `terminal`, máximo 300 s; termina la espera, no el job |
| `result` | `id`, `operation: "peek" \| "consume"` | Revisión vigente y DTO acotado; `consume` es mutante |
| `spawn` | `agent`, `task` | Resuelve agente/modelo/confianza y cwd de la sesión activa; retorna recibo de admisión, no espera generación |
| `control` | `id`, `action: "pause" \| "resume" \| "cancel" \| "retry"`, `reason?` | Política de propiedad existente; retry crea otro job; razón hasta 2048 caracteres |
| `review` | No se ejecutan decisiones recibidas | Siempre `RPC_REVIEW_FORBIDDEN` |

`spawn` reutiliza `JobsService.start` y el resolver existente (`resolveInput`), no símbolos históricos inexistentes como `buildStartInput`/`JobManager.start`. No acepta cwd, tools, credenciales o snapshot arbitrarios del caller. Se conservan las reglas actuales de confianza de proyecto y modelos soportados.

`status`, `list` y `wait` proyectan por allowlist: ID, estado público, nombre de agente, modelo, instantes, posición de cola, duración, disponibilidad de resultado, estado de revisión y resumen de consumo. No retornan `JobRecord`, prompts, definición completa del agente, `filePath`, cwd, tarea, errores internos, actores o historial de control. `provisioning` sigue proyectado como `running` en vistas públicas; el evento específico identifica el paso interno sin cambiar esa compatibilidad.

`result` por RPC aplica el acceso restringido de fase 01, también durante un replay: no devuelve cuerpos `pending` o `rejected`. La excepción de lectura para el padre solo corresponde a su tool interna y a la ruta interna de entrega, con relación de creación verificada; un RPC `callerId` declarativo no acredita parentesco ni hereda esa excepción. RPC retorna texto UTF-8 acotado, `totalBytes`, SHA-256 del texto completo e indicador `truncated`, con metadatos públicos de job/resultado. El sobre JSON serializado completo debe caber en 65536 bytes: se reserva espacio para metadatos y escaping antes de truncar en frontera UTF-8. No se incluyen el cuerpo completo en otro campo, una ruta de archivo ni mensajes internos de error. La disponibilidad de resultados de jobs cancelados debe comprobarse con el contrato de dominio; no se fabrica un resultado cuando el servicio responde `RESULT_NOT_READY`.

### 3.4 Descubrimiento y capacidades

`ready` y `ping` comparten: `protocolVersion`, `sessionId`, versión de implementación, capacidades `query`, `wait`, `result`, `spawn`, `control`, operaciones disponibles y límites. Deben declarar explícitamente `rpcReview: false`, `activePause: false` y que cancelación activa requiere confirmación humana TUI y solo está disponible en ese modo con UI activa.

Límites: `maxListPage: 100`, `maxWaitSeconds: 300`, `maxResultBytes: 65536`, `recentEventWindow: 1000`, consultas cortas 5 s y aceptación de mutaciones 30 s. La capacidad de revisión RPC no se anuncia. Capacidades posteriores solo pueden añadirse sin versionar protocolo si son compatibles y opcionales.

El caller no debe depender de haber presenciado `ready`: un caller cargado posteriormente puede usar `ping`. `ready` no es un evento durable ni un acuse de suscripción de consumidores.

## 4. Autoridad de control y confirmación

Antes de ejecutar un control se aplica la política de dominio: actor extension solo controla jobs que le correspondan bajo la política existente. El adaptador no convierte una aprobación TUI en actor `human`: conserva el actor extension del control y la evidencia interna de confirmación de la UI.

Cancelación activa (`provisioning`, `running` o `cancelling`, sujeto a las transiciones permitidas) requiere TUI con UI activa y confirmación explícita. En otros modos se responde `CAPABILITY_UNAVAILABLE`; si el humano rechaza, no se persiste una nueva intención. `pause` activo mantiene `PAUSE_ACTIVE_UNSUPPORTED`.

La comprobación debe resistir la carrera queued → running: una lectura inicial queued no autoriza a cancelar ejecución activa sin confirmación. Se debe verificar el requisito de confirmación contra el estado de la transacción efectiva; si ahora requiere confirmación, no se comitea ese control y el servicio solicita el consentimiento o devuelve indisponibilidad. Una confirmación es local al intento, job y generación; nunca se toma del payload RPC. El plan deberá cubrir ese ajuste dirigido en la frontera común de control y su prueba, sin duplicar transiciones en el adaptador.

Los replays autorizados de una cancelación ya persistida no ejecutan otro aborto ni requieren una nueva confirmación para repetir el recibo; no evitan la política vigente de acceso. Los errores de estado o incertidumbre se conservan como en fase 02; una solicitud aceptada no garantiza aborto inmediato ni `cancelled`.

## 5. Idempotencia

Se reutiliza `RequestLedgerDocFamily`, sin ledger RPC paralelo con TTL ni anillo que permita reutilizar request IDs antiguos. Su ámbito sigue siendo la base de la sesión. Un ID previamente empleado por otra operación/actor o con otro payload no se interpreta como una nueva solicitud.

Mutantes: `spawn`, `control` —incluido retry— y `result consume`. Las consultas y `result peek` no persisten cada respuesta. `review` no alcanza el ledger porque está prohibido.

El hash canónico se obtiene después de normalizar mediante los servicios existentes y contiene la operación de dominio, parámetros efectivos, job objetivo cuando proceda y actor extension con caller ID. No incluye `correlationId`, deadlines de transporte ni el canal de respuesta. La serialización ordena claves y conserva significado según la versión canónica del dominio. No se reutiliza un ID al cambiar parámetros para superar un timeout.

RPC presenta `REQUEST_ID_CONFLICT` para conflictos de payload, incluso cuando el servicio interno devuelve `CONTROL_CONFLICT`; se conserva la distinción interna sin filtrar detalles. La autorización y revisión vigentes se verifican antes de exponer un recibo o resultado histórico. Una repetición válida devuelve el recibo de la mutación original, con nueva correlación y sin otra transición, consumo ni evento. No se promete igualdad byte a byte del sobre de transporte.

## 6. Eventos

Cada evento tiene `protocolVersion: 1`, `eventId`, secuencia positiva monotónica por sesión, `sessionId`, `jobId`, `type`, instante `occurredAt` y `data` proyectado. `eventId` es estable y deriva de sesión y secuencia persistida; no cambia en una reemisión. IDs son opacos para consumidores.

| Commit observable | Tipo/canal | Regla |
| --- | --- | --- |
| Admisión de job, incluido retry | `job.queued` / `job:queued` | Un evento para el nuevo job; `retryOf` opcional como ID opaco |
| Preparación durable de conversación | `job.provisioning` / `job:provisioning` | Después del claim efectivo, dentro de su commit |
| Registro del envío y estado activo | `job.started` / `job:started` | Commit que registra `submissionId` y `running` |
| Pausa queued | `job.paused` / `job:paused` | Cambio efectivo a paused |
| Reanudación de paused | `job.resumed` / `job:resumed` | Reinserción de ese job en cola; no otro queued |
| Intención de cancelación activa | `job.cancel-requested` / `job:cancel-requested` | Misma transacción que `control.pending` |
| Cancelación queued/paused o activa confirmada | `job.cancelled` / `job:cancelled` | No anunciarla antes del efecto confirmado |
| Terminal | `job.completed`, `job.failed`, `job.interrupted` / canales correspondientes | Solo en el commit terminal efectivo |
| Decisión humana o parental nativa autorizada | `job.reviewed` / `job:reviewed` | Cambio efectivo de status o toma de autoridad humana; no replay/no-op |
| Consumo autorizado | `job.consumed` / `job:consumed` | Incremento efectivo de consumo, incluido desde tools |

Un commit puede crear más de un evento cuando realmente cambia varias entidades; sus secuencias son consecutivas y deterministas dentro de ese commit. Rechazos, replays y asignaciones sin cambio efectivo no producen eventos. Se elimina `pause-requested`: no existe una pausa activa implementada. Cancelar directamente queued/paused emite cancelled, no una intención activa inexistente. Marcar notificación Pi no es un evento de dominio de esta fase.

`data` es una allowlist: estado público, nombre de agente, `hasResult` y, según tipo, estado de revisión, contador de consumo o `retryOf`. No lleva tareas, prompts, definición del agente, texto de respuesta, cwd, rutas, stdout, error libre, motivo de control, request completo ni secretos. No hay modo diagnóstico que habilite rutas en los eventos de fase 03. Identificadores y nombres siguen siendo datos del proceso; no se presenta esta redacción como un canal apto para consumidores externos no confiables.

## 7. Outbox y recuperación

### 7.1 Modelo propuesto

- Documento de metadatos: siguiente secuencia, posiciones de escritura/emisión e índice reciente.
- Familia de documentos de eventos, uno por secuencia/ID, con sobre inmutable y estado de emisión separado de los campos públicos.
- Índices paginados de pendientes, con páginas de tamaño fijo; nunca un array de todos los pendientes en el documento raíz. Tamaño físico de página y lote de emisión son detalles de implementación, no contratos RPC.
- Índice reciente con referencias a los últimos **1000 eventos emitidos**, sin copiar cuerpos completos.

La retención acota esa ventana indexada, no los documentos históricos ni el espacio físico SQLite. Pendientes nunca se descartan por antigüedad, tamaño de ventana o error de consumidor. No se introduce un endpoint de replay ni una estrategia de GC física oculta bajo esa retención.

### 7.2 Atomicidad obligatoria

En cualquier entrada —comando, tool, RPC, coordinador o reconciliación— la transición observable, ledger aplicable y creación del evento deben estar en **el mismo commit Durable**. No basta con un callback posterior a la transacción, `onSettled`, notificación Pi o polling de estados. Si falla la escritura del evento, se revierte el commit completo. La secuencia avanza en ese mismo commit, sin reservar números en memoria.

Un replay sale antes de escribir eventos. Operaciones concurrentes se serializan mediante los commits; no basta con un lock exclusivo del adaptador RPC. La migración no utiliza esta ruta para fabricar eventos anteriores.

### 7.3 Emisor

Un único emisor por runtime recorre pendientes por secuencia, lee cada evento y lo envía al canal correspondiente. Confirma la emisión con `emittedAt` y avanza el cursor/ventana reciente en un commit posterior. La confirmación no crea otro evento de dominio. Se procesa por lotes y se cede el control al event loop para no bloquear la sesión por un backlog.

Si ocurre una caída tras emitir pero antes de confirmar, el evento vuelve a emitirse con el mismo ID y secuencia. Un fallo del propio emisor deja pendiente el evento y no salta a otros para fingir orden. El fallo de un listener consumidor no es un acuse negativo observable por este bus: no se transforma en garantía de redelivery a ese consumidor.

Al abrir una sesión, el runtime recompone posiciones desde SQLite; registra handlers, anuncia ready y drena pendientes. Durante la reconciliación pueden aparecer eventos nuevos, pero no se emiten antes de que esa generación esté preparada. No se emite cuando la sesión está inactiva. Eventos ya marcados emitidos no se repiten solo porque apareció otro consumidor; este consulta el estado actual.

### 7.4 Garantía exacta

Hay atomicidad de efectos/eventos **dentro de SQLite** y reintentos de emisión de pendientes al bus, con posibles duplicados. No existe entrega exactamente una vez, acuse de procesamiento, replay completo a nuevos consumidores ni entrega eventual garantizada a un listener ausente. El consumidor deduplica por sesión/eventId y usa status/list para reconciliar; un hueco de secuencias no prueba una pérdida porque puede escuchar solo algunos tipos.

## 8. Deadlines y lifecycle

### Deadlines

- `ping`, `status`, `list`, `result peek`: 5 s internos.
- `spawn`, `control`, `result consume`: 30 s para persistir aceptación/efecto local; no para completar la generación.
- `wait`: `timeoutSeconds` de fase 01, hasta 300 s; el caller concede margen de transporte.

El tiempo de confirmación humana cuenta dentro del deadline de aceptación. No se espera indefinidamente a una UI. Si el deadline o la generación expiran antes de recibir consentimiento, una confirmación tardía no habilita la admisión del control; se ignora para ese intento. Una mutación ya admitida a persistencia puede completar después del deadline. Al expirar, se publica como máximo una respuesta de timeout de ese intento; completar una promesa posteriormente no habilita una segunda respuesta. Un timeout o falta de respuesta no acredita ausencia de commit. El caller repite con el mismo requestId y otra correlación. El servidor no revierte commits ni cancela jobs por timeout.

Cada caller retira su listener tras respuesta, timeout o cierre; las llamadas recibidas no crean nuevos handlers servidores permanentes. Duplicados de correlación se descartan sin segunda respuesta y se retira el registro temporal al finalizar el intento. La configuración inicial de esta fase no añade un sistema de cuotas o backpressure del dominio: no se promete resistencia frente a extensiones hostiles cargadas en el proceso. Si la implementación necesita límites de admisión adicionales, deben proponerse y aprobarse, no descartar eventos ni cambiar la semántica silenciosamente.

### Generaciones y cierre

El propietario usa un token interno de generación además del sessionId: reabrir la misma sesión también invalida las closures anteriores. Cada solicitud/emisor captura esa generación y la verifica antes de emitir una respuesta o evento.

Los handlers RPC se registran desde session_start, no en la fábrica. Al cambiar sesión se sella la anterior, se abortan esperas y se cierran recursos antes de anunciar la nueva. Solicitar otra sesión en un runtime activo produce `SESSION_MISMATCH`; una solicitud no puede seleccionar arbitrariamente otro SQLite.

Durante el cierre se deja de admitir trabajo y se responde `RPC_SHUTTING_DOWN` a nuevas llamadas solo mientras el endpoint todavía está presente para rechazar. Se terminan las esperas sin cancelar jobs, se detienen emisor y timers, se drenan operaciones de almacenamiento admitidas y se liberan listeners, Harness y lease de forma idempotente. Después de retirar el endpoint/completar shutdown no se publica ninguna respuesta RPC tardía, error RPC tardío o evento de la generación cerrada. La integración parental usa `retire()` para drenar fase 1 sin esperar proveedor; `close()` libera el lease solo tras cierre SDK satisfactorio. Los fallos operativos de ese cierre se reportan sin reactivar autoridad. Los pendientes de outbox permanecen durables.

Una migración rechazada o apertura fallida no anuncia ready. No se registra un endpoint listo que dependa de que una llamada posterior abra correctamente el runtime. Un caller sin endpoint debe gestionar su timeout; no existe una respuesta mágica cuando no hay listener servidor.

## 9. Errores públicos

Se reutiliza el sobre de errores común de fases anteriores. Nuevos códigos:

| Código | Significado | Reintento |
| --- | --- | --- |
| `PROTOCOL_UNSUPPORTED` | Versión no soportada | No con esa versión |
| `SESSION_MISMATCH` | Sesión esperada distinta de la activa | Descubrir sesión; no redirigir mutación silenciosamente |
| `CAPABILITY_UNAVAILABLE` | Operación no disponible en modo/capacidad actual | Cambiar entorno o acudir a TUI |
| `RPC_SHUTTING_DOWN` | Endpoint sellado | Esperar ready y conservar ID de mutación |
| `RPC_REVIEW_FORBIDDEN` | Revisión humana no permitida por RPC | TUI, no reintentar por allowlist |
| `RPC_TIMEOUT` | Deadline interno vencido, resultado de commit incierto | Mismo requestId, otra correlación |

`INVALID_REQUEST` cubre solicitudes malformadas cuando exista correlación segura para responder. Una correlación ya en vuelo se descarta sin responder de nuevo en el canal ocupado. `WAIT_TIMEOUT` sigue identificando una espera que no cumplió su predicado; no se confunde con fallo del job. Se preservan códigos de permisos, estados, revisión, filtros y storage de dominio salvo normalización explícita del conflicto RPC. No se introduce `CALLER_NOT_ALLOWED` como si existiera autenticación: esta fase no incluye una allowlist de identidades verificables.

Mensajes inesperados usan error sanitizado y details vacío o allowlist explícita, sin paths, stack, params o contenido del trabajo. Los códigos son contratos; textos localizados no son criterios de compatibilidad.

## 10. Migración 4 → 5

La base esquema 4 debe migrarse antes de abrir el runtime de fase 03. Se preserva el flujo existente de mantenimiento humano TUI: lease exclusivo, inspección, backup consistente verificado, consentimiento sobre la fuente y conversión atómica. Declinar no cambia la base ni inicia RPC/emisor.

La migración conserva jobs, estados, resultados, reviews, consumo, historial y ledger; inicializa outbox vacío y secuencia en 1. No inventa eventos históricos ni resetea request IDs. Esquema 5 ya migrado es idempotente; versiones futuras desconocidas se rechazan. Las bases más antiguas conservan la cadena de migraciones humanas existente antes de llegar a 4 → 5; no se borran rutas de mantenimiento previas ni se aplican migraciones implícitas por RPC.

Una reapertura después de cada ventana de backup/migración debe demostrar ausencia de pérdida y reconocimiento claro del esquema. La fixture de aceptación debe distinguir datos reales de placeholders para no repetir las limitaciones históricas de la prueba TUI de fase 02.

## 11. Criterios de aceptación

| ID | Gate verificable |
| --- | --- |
| AC-03-01 | Ping sin sessionId descubre la sesión; ready y ping presentan capacidades reales, límites y review prohibido |
| AC-03-02 | Sobres, operaciones y DTO se validan en runtime; requests malformados, IDs inseguros y versiones desconocidas no generan mutaciones |
| AC-03-03 | Reintentos/concurrencia con misma intención generan un solo efecto/recibo y los eventos correspondientes una sola vez en storage; otro payload falla |
| AC-03-04 | Mutación y evento son atómicos en todas las entradas, no solo RPC; fallo de escritura del evento revierte la mutación |
| AC-03-05 | Caída después de emisión y antes de confirmación duplica con mismo eventId; reapertura drena pendientes en orden |
| AC-03-06 | Pendientes cruzan varias páginas; ventana reciente conserva como máximo 1000 referencias sin borrar pendientes ni prometer GC física |
| AC-03-07 | Status/list/wait no materializan cuerpos de resultados ni exponen snapshots internos; result cabe en 65536 bytes incluyendo JSON y escaping |
| AC-03-08 | Result RPC pending/rejected no se expone ni mediante replay; la excepción de lectura del padre no autoriza RPC; consumo repetido no incrementa contador ni crea otro evento |
| AC-03-09 | Actor forjado, control no autorizado y review RPC se rechazan; spoofing de callerId no se presenta como resuelto |
| AC-03-10 | Cancel activa requiere consentimiento TUI; carrera queued→running y timeout/rechazo de confirmación no la evitan; pausa activa sigue no soportada |
| AC-03-11 | Deadlines, correlaciones y respuestas tardías no producen doble respuesta; timeout no revierte commit ni cancela job |
| AC-03-12 | Cambio de sesión, reapertura con mismo sessionId y shutdown no dejan listeners/timers/esperas de otra generación ni publicaciones tardías |
| AC-03-13 | Eventos y errores no contienen tareas, prompts, resultados, motivos libres, rutas, stdout o secretos |
| AC-03-14 | Migración autorizada 4→5, backup, declinación, reapertura y esquema desconocido conservan datos/ledger y no fabrican eventos |
| AC-03-15 | Caller de prueba instala listener antes de emitir, deduplica, reintenta y limpia; prueba de namespace con canales upstream no registra colisiones |
| AC-03-16 | npm run check y npm test verdes, smoke de carga e inventario de paquete sin estado local |
| AC-03-17 | Revisión independiente y aceptación humana TUI documentadas sin inferirlas de gates automáticos |

Pruebas: contratos JSON con campos opcionales aditivos, entradas malformadas, concurrencia/replay, transacciones reales Durable, fixtures de esquema 4, fallos antes/después de commit, bus controlado con caída entre emisión/confirmación, paginación y ventana reciente, privacidad con cadenas sensibles centinela, y caller ficticio. La inspección de código upstream no acredita ejecución local; los gates anteriores son requisitos futuros, no resultados ya obtenidos.

La aceptación TUI debe probar consentimiento de cancelación activa, rechazo y timeout, control queued y migración 4→5 desde un cwd no relacionado; una UI humana aprueba, el caller mantiene actor extension. El escenario debe conservar evidencia de fuentes de datos válidas y de los límites experimentales. El test de namespace solo prueba aislamiento de canales; no debe describirse como convivencia completa con upstream si no se carga ese paquete real.

## 12. Documentación y handoff

La implementación debe entregar una referencia RPC separada con operaciones, esquemas, capacidades, errores, deadlines, ejemplos de correlación/reintento/deduplicación, política declarativa de caller y límites de retención. README y arquitectura solo se actualizarán al comportamiento realmente implementado. La documentación de aceptación separará Node, integración del host, TUI humana y revisión independiente.

La aprobación del documento escrito habilita el plan de implementación; no autoriza ejecutarlo. El plan debe tratar explícitamente atomicidad en cada ruta, confirmación frente a carreras, autorización/replay y migración, sin usar APIs privadas o introducir otro runtime global.

## 13. Evidencia y fuentes consultadas

Consulta: 2026-10-07 UTC. Fuente primaria pública: [docs de extensiones de Pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md) y [ejemplo event-bus](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/event-bus.ts). Los enlaces de rama main pueden cambiar; la inspección local correspondió al paquete instalado Pi `1.0.4`, no a un commit upstream identificado.

Inspección local realizada, no modificada:

- `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`: lifecycle y recursos desde session_start; cleanup idempotente y contexto invalidado por cambio de sesión.
- `.../dist/core/event-bus.d.ts`: `emit(channel, data): void` y `on(channel, handler): () => void`.
- `.../dist/core/event-bus.js`: usa EventEmitter; wrappers de listeners capturan y reportan sus errores, sin await desde emit. Por tanto no existe ack de consumidor en el contrato inspeccionado.
- `.../examples/extensions/event-bus.ts`: comunicación interextensión mediante canales y contexto de session_start.
- `.../dist/core/extensions/types.d.ts`: session_start contempla startup, reload, new, resume y fork.
- Código local en `src/application/jobs.ts`, `control.ts`, `result.ts`, `query.ts`, `src/domain/requests.ts`, `jobs.ts`, `errors.ts`, `src/runtime/session.ts` y `src/infrastructure/durable/{documents,repository}.ts`: servicios reales, política de propiedad, ledger, proyecciones y commits a extender.

Las rutas abreviadas `.../` representan archivos del paquete host indicado, no activos de evidencia en este workspace. No se ejecutaron probes de RPC ni de outbox de fase 03: esos componentes siguen sin implementar.
