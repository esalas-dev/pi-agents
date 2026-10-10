# 01 — Consulta, listado y espera

## Estado

Diseño aprobado por el usuario después de completar la fase 00. Primera fase funcional; depende del esquema 2 validado en la [fase 00 — Preparación arquitectónica](00-preparacion-arquitectonica.md). Usa su almacenamiento separado, actores, ledger y servicios compartidos; no parte directamente del monolito v1. La implementación queda bloqueada hasta aprobar el plan de ejecución.

**Enmienda aprobada el 2026-10-08:** el padre verificado debe recibir los resultados de sus subagentes sin un gate humano por lectura. Este es el comportamiento objetivo de una implementación futura; el runtime actual conserva su gate hasta que el cambio se implemente, revise y acepte. El [diseño de comunicación padre-hijos](../docs/superpowers/specs/2026-10-08-comunicacion-padre-hijos-design.md), aprobado por el usuario, concreta la entrega, la identidad por sesión y la lectura por tramos.

## Objetivo

Ofrecer una API común y durable para consultar un trabajo, listar trabajos de la sesión, esperar su terminación y recuperar su resultado sin convertir una espera cancelada en cancelación del trabajo.

Esta fase separa tres conceptos:

1. observar estado;
2. esperar un cambio;
3. exponer o consumir el resultado.

## Fuera de alcance

- Cancelar, pausar o reintentar: especificación 02.
- Consultar todas las sesiones o abrir sus SQLite simultáneamente.
- Delegación anidada y equipos coordinados; el alcance es el agente padre y sus trabajos hijos directos.
- Aprobar o fusionar cambios producidos por el trabajo.
- Streaming de tokens o logs en vivo.

## Requisitos funcionales

### RF-01 — Consulta por ID

Debe existir un servicio de dominio `getJob(id)` que retorne una vista inmutable y normalizada. `provisioning` se conserva internamente, pero la vista pública puede seguir mostrándolo como `running` e incluir `internalStatus` solo para diagnóstico humano.

La vista mínima contiene:

- `id`;
- `status` e `internalStatus` opcional;
- agente, fuente y descripción;
- tarea, con opción de omitirla en listados compactos;
- modelo y nivel de razonamiento;
- cwd;
- instantes de creación, inicio, actualización y finalización;
- posición en cola;
- duración;
- existencia de resultado y error;
- revisión y consumo;
- enlaces futuros `retryOf`, `groupId` y `workflowId`, inicialmente ausentes.

### RF-02 — Listado de sesión

Debe existir `listJobs(filter)` limitado al SQLite de la sesión principal activa. Filtros:

- uno o varios estados públicos;
- nombre de agente;
- creados antes/después de un instante;
- solo pendientes de revisión;
- límite entre 1 y 100, predeterminado 20;
- cursor opaco para paginación.

Orden predeterminado: `createdAt` descendente y `id` como desempate. El cursor no puede depender de índices de arreglo volátiles.

### RF-03 — Espera acotada

`waitForJob(id, options)` espera hasta:

- estado terminal;
- estado solicitado en `until`;
- timeout;
- aborto de la llamada por el usuario.

Cancelar la espera **no** cancela ni modifica el trabajo. El timeout permitido será de 0 a 300 segundos; `0` equivale a consulta inmediata. La espera debe comprobar primero el snapshot durable para evitar perder una transición ocurrida antes de registrar el listener.

### RF-04 — Recuperación de resultado

Un resultado terminal debe poder recuperarse sin mutarlo. Se distinguen:

- `peek`: lectura humana o del agente padre que no marca consumo;
- `consume`: lectura por un consumidor identificado, que persiste un recibo de consumo (`consumedAt`, `consumedBy`, `consumeRequestId`) en el ledger y actualiza el agregado de consumo.

Al finalizar un subagente vinculado, se entrega a su agente padre un mensaje acotado con el resultado, sin requerir aprobación humana por lectura; si excede el límite, el padre puede recuperar el texto completo por tramos. Si el padre no está activo para recibir la entrega, el resultado queda durable y el padre puede recuperarlo después mediante `pi_agents_result`. La entrega automática es una lectura, no un consumo; `consume` sigue siendo explícito e idempotente. Repetir `consume` con el mismo `requestId` es idempotente. Un consumidor distinto puede leer el resultado, pero el historial de consumo debe conservar al menos el primer y último consumo sin crecimiento ilimitado.

### RF-05 — Revisión humana

Se añade un estado de revisión independiente:

```text
not_required | pending | approved | rejected
```

Valores predeterminados:

- trabajos antiguos migrados: `not_required`;
- trabajos nuevos iniciados por un humano: `not_required`, salvo política configurada;
- trabajos nuevos iniciados por modelo o RPC: `pending`.

Los comandos TUI pueden mostrar el resultado completo aunque esté `pending`, porque su salida no se envía al modelo. La tool del agente padre puede leer mediante `peek` el resultado de sus propios subagentes, por tramos si es necesario, con cualquier estado de revisión, incluido `rejected`; debe recibir el estado y motivo de revisión junto al resultado. Un rechazo humano no oculta el informe al padre ni equivale a aprobarlo: el contenido sigue siendo salida no confiable y no concede permiso para promover cambios o ejecutar acciones protegidas. Las tools y callers que no sean el padre autorizado solo devuelven el cuerpo cuando la revisión es `approved` o `not_required`; en otro caso retornan metadatos y `RESULT_REVIEW_REQUIRED` o `RESULT_REJECTED`.

Aprobar o rechazar requiere una acción humana explícita mediante comando. La extensión no inferirá aprobación del hecho de consultar o recibir un resultado.

### RF-06 — Límites de salida

Una tool devolverá como máximo 64 KiB de respuesta textual total, incluidos metadatos. La entrega automática al padre respeta el mismo límite. Si el resultado excede el límite debe incluir:

- prefijo truncado;
- longitud total;
- `sha256` del contenido completo;
- indicador `truncated: true`;
- instrucción para consulta humana completa o recuperación por tramos para el padre verificado, con offsets en bytes UTF-8 y sin consumo.

El contenido completo permanece en SQLite; no se creará un archivo temporal salvo solicitud futura.

## Contratos de interfaz

### Comandos

```text
/subagents status <id>
/subagents result <id>
/subagents list [--status <estado>] [--limit <n>]
/subagents wait <id> [--timeout <segundos>]
/subagents approve <id> [--reason <texto>]
/subagents reject <id> [--reason <texto>]
```

`result` es una vista humana y no añade contenido al contexto del modelo. La entrega del resultado de un subagente a su padre sí se añade al contexto de ese padre, claramente atribuida al agente hijo y marcada como salida no confiable.

### Tools

- `pi_agents_status({ id })`
- `pi_agents_list({ statuses?, agent?, limit?, cursor?, pending_review? })`
- `pi_agents_wait({ id, until?, timeout_seconds? })`
- `pi_agents_result({ id, consume?, request_id?, offset? })`; `offset` es la ampliación futura para lectura `peek` por tramos del padre verificado, no para RPC.

No se añadirá un parámetro de aprobación a ninguna tool.

## Modelo persistente

Esta fase amplía el esquema global 2 validado en fase 00 con esquema 3 y migración propia. La conversión estructural del monolito v1 pertenece a fase 00; esta fase define explícitamente la conversión esquema 2 → esquema 3.

El esquema 3 mantiene el job técnico separado de la revisión y el consumo:

```ts
JobReviewDocFamily(jobId) {
  status: "not_required" | "pending" | "approved" | "rejected";
  decidedAt?: number;
  decidedBy?: string;
  reason?: string;
}

JobConsumptionDocFamily(jobId) {
  firstConsumedAt?: number;
  lastConsumedAt?: number;
  count: number;
  lastConsumer?: string;
  requestIds: string[]; // historial reciente, no autoridad de deduplicación
}
```

`JobRecord` conserva `createdBy?: Actor` para fijar la política de revisión y el índice conserva `reviewStatus` y `hasResult`. La relación con el padre autorizado debe establecerse por el adaptador desde el contexto confiable de creación y persistirse junto al job; nunca se acepta desde la tarea, el resultado ni un campo RPC declarativo. Si el host no permite verificar esa relación, no se concede acceso amplio a todos los jobs de la sesión. La migración 2→3 crea revisión `not_required` y consumo vacío para jobs existentes. Jobs nuevos iniciados por `model` o RPC reciben `pending`; los iniciados por `human` reciben `not_required`, salvo política futura explícita.

`requestIds` puede limitarse a los últimos 32 IDs para consulta del historial reciente. La autoridad de deduplicación es el ledger durable, ampliado con operaciones tipadas `start`, `consume` y `review`; cada recibo de `consume` conserva `consumedAt`, `consumedBy` y `consumeRequestId`. Expulsar un ID del historial reciente no permite ejecutar de nuevo la misma solicitud. Recibo, consumo y decisión se actualizan en un único commit.

## Consistencia y recuperación

- La consulta siempre lee un snapshot Durable; no usa el objeto devuelto originalmente por `start`.
- La espera usa el patrón «leer, suscribir, volver a leer» para cerrar la carrera entre snapshot y listener.
- El consumo se confirma en el mismo commit que incrementa su contador.
- Una caída después de devolver el resultado pero antes del commit puede producir una segunda entrega. El cliente debe aportar `requestId`; sin él se documenta semántica al menos una vez.
- Reabrir la sesión reconstruye cualquier espera desde el estado, no persiste promesas.

## Errores estables

- `JOB_NOT_FOUND`
- `INVALID_FILTER`
- `WAIT_TIMEOUT`
- `WAIT_ABORTED`
- `RESULT_NOT_READY`
- `RESULT_REVIEW_REQUIRED`
- `RESULT_REJECTED`
- `REQUEST_ID_CONFLICT`

Timeout y aborto de espera no se marcan como error del trabajo.

## Seguridad y control humano

- Los listados compactos no incluyen tarea ni resultado por defecto.
- Resultados pendientes o rechazados solo llegan al modelo padre con relación de creación verificada; los demás callers no reciben el cuerpo.
- Una aprobación registra actor, instante y motivo; no cambia el estado técnico del trabajo.
- Aprobar un resultado no ejecuta comandos, no fusiona ramas y no promueve artefactos.
- Las rutas y errores internos se muestran completos solo en vistas humanas de diagnóstico.

## Criterios de aceptación

1. Dado un trabajo en cola, `status` devuelve su posición actual.
2. Dado un trabajo que termina entre el snapshot y la suscripción, `wait` retorna terminal sin agotar timeout.
3. Abortar `wait` deja el trabajo ejecutándose.
4. Un resultado `pending` es visible mediante comando humano y llega acotado al padre verificado sin aprobación, con acceso al resto por tramos; un caller no relacionado sigue bloqueado.
5. Un resultado `rejected` también llega al padre con estado y motivo visibles, sin convertirse en aprobación; un caller no relacionado sigue bloqueado.
6. Si el padre no está activo cuando termina el hijo, la respuesta queda durable y puede recuperarse sin volver a pedir aprobación.
7. Tras `approve`, los callers sujetos al gate pueden leerlo; esa aprobación no registra consumo.
8. Dos consumos con el mismo `requestId` incrementan el contador una sola vez.
9. Un resultado mayor de 64 KiB se trunca en tool y conserva hash y longitud.
10. Cerrar y reabrir Pi conserva revisión y consumo.
11. Listados paginados no repiten ni omiten trabajos si no se insertan trabajos entre páginas.
12. Una base del esquema de fase 00 migra sin perder jobs, cola, resultados ni notificaciones; una fixture histórica v1 conserva esos datos al recorrer primero la migración de fase 00.

## Pruebas

- Unitarias: filtros, cursores, normalización, límites, códigos de error.
- Integración Durable: consulta, consumo y revisión tras reapertura.
- Entrega al padre: recepción automática de resultados `pending`, `approved` y `rejected`, atribución y marca de salida no confiable; recuperación durable si el padre no está activo.
- Carreras: terminar antes, durante y después de instalar la espera.
- Propiedad: paginación estable para secuencias arbitrarias de timestamps repetidos.
- Seguridad: solo el padre verificado recibe cuerpos pendientes/rechazados; tools y callers no relacionados siguen sujetos al gate.
- Compatibilidad: comandos actuales mantienen formato suficiente para usuarios existentes.

## Entregables documentales

- README con nuevos comandos y tools.
- Arquitectura con servicio de consultas y política de revisión.
- Tabla de ampliación/migración desde el esquema de fase 00 y prueba de la ruta histórica v1 → fase 00 → fase 01.
- Plan de implementación aprobado antes de modificar código.

## Decisiones aprobadas de diseño

- La consulta se implementa como una capa de aplicación sobre el repositorio de fase 00; los adaptadores no replican la máquina de estados.
- `JobsIndexDoc` se usa como proyección compacta para filtros y cursores; el cursor opaco codifica `(createdAt,id)` descendente y no depende de `order`.
- La espera usa `watchDoc` con el patrón snapshot → suscripción → snapshot; timeout y aborto afectan únicamente a la espera.
- Ninguna tool puede aprobar resultados. El padre verificado recibe automáticamente los resultados de sus subagentes, incluso `pending` o `rejected`, como salida no confiable; otros callers mantienen el gate humano TUI.
- El límite de tool es 64 KiB de texto; el resultado completo continúa en SQLite y el prefijo incluye longitud, SHA-256 e indicador de truncado.
- El resultado humano es `peek` por defecto. `consume` exige `requestId` para deduplicación fuerte y registra consumidor, contador y timestamps.
- La migración 2→3 requiere mantenimiento explícito y bloqueo del runtime mientras no finalice.
