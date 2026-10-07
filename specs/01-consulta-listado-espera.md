# 01 — Consulta, listado y espera

## Estado

Propuesta. Primera fase funcional; depende de completar y validar la [fase 00 — Preparación arquitectónica](00-preparacion-arquitectonica.md). Usa su almacenamiento separado, actores, ledger y servicios compartidos; no parte directamente del monolito v1.

## Objetivo

Ofrecer una API común y durable para consultar un trabajo, listar trabajos de la sesión, esperar su terminación y recuperar su resultado sin convertir una espera cancelada en cancelación del trabajo.

Esta fase separa tres conceptos:

1. observar estado;
2. esperar un cambio;
3. exponer o consumir el resultado.

## Fuera de alcance

- Cancelar, pausar o reintentar: especificación 02.
- Consultar todas las sesiones o abrir sus SQLite simultáneamente.
- Reinyectar automáticamente resultados al modelo principal.
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

- `peek`: lectura humana que no marca consumo;
- `consume`: lectura por un consumidor identificado, que persiste `consumedAt`, `consumedBy` y `consumeRequestId`.

Repetir `consume` con el mismo `requestId` es idempotente. Un consumidor distinto puede leer el resultado, pero el historial de consumo debe conservar al menos el primer y último consumo sin crecimiento ilimitado.

### RF-05 — Revisión humana

Se añade un estado de revisión independiente:

```text
not_required | pending | approved | rejected
```

Valores predeterminados:

- trabajos antiguos migrados: `not_required`;
- trabajos nuevos iniciados por un humano: `not_required`, salvo política configurada;
- trabajos nuevos iniciados por modelo o RPC: `pending`.

Los comandos TUI pueden mostrar el resultado completo aunque esté `pending`, porque su salida no se envía al modelo. Las tools solo devuelven el cuerpo completo cuando la revisión es `approved` o `not_required`; en otro caso retornan metadatos y `RESULT_REVIEW_REQUIRED`.

Aprobar o rechazar requiere una acción humana explícita mediante comando. La extensión no inferirá aprobación del hecho de consultar un resultado.

### RF-06 — Límites de salida

Una tool devolverá como máximo 64 KiB de respuesta textual. Si el resultado excede el límite debe incluir:

- prefijo truncado;
- longitud total;
- `sha256` del contenido completo;
- indicador `truncated: true`;
- instrucción para consulta humana completa.

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

`result` es una vista humana y no añade contenido al contexto del modelo.

### Tools

- `pi_agents_status({ id })`
- `pi_agents_list({ statuses?, agent?, limit?, cursor?, pending_review? })`
- `pi_agents_wait({ id, until?, timeout_seconds? })`
- `pi_agents_result({ id, consume?, request_id? })`

No se añadirá un parámetro de aprobación a ninguna tool.

## Modelo persistente

Esta fase amplía el esquema global 2 propuesto por fase 00, con una nueva versión y migración propia. El número de versión se fijará al diseñar esta fase sobre la implementación validada. La conversión estructural del monolito v1 pertenece a fase 00.

`JobRecord` incorpora de forma opcional durante la migración:

```ts
review?: {
  status: "not_required" | "pending" | "approved" | "rejected";
  decidedAt?: number;
  decidedBy?: string;
  reason?: string;
};
consumption?: {
  firstConsumedAt?: number;
  lastConsumedAt?: number;
  count: number;
  lastConsumer?: string;
  requestIds: string[]; // historial reciente, no autoridad de deduplicación
};
createdBy?: {
  kind: "human" | "model" | "extension" | "system";
  id?: string;
};
```

`requestIds` puede limitarse a los últimos 32 IDs para consulta del historial reciente. La autoridad de deduplicación es el ledger durable de fase 00, ampliado para `consume`; expulsar un ID del historial reciente no permite ejecutar de nuevo la misma solicitud. Recibo y contador se actualizan en un único commit.

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
- Los resultados pendientes o rechazados no llegan completos al modelo.
- Una aprobación registra actor, instante y motivo; no cambia el estado técnico del trabajo.
- Aprobar un resultado no ejecuta comandos, no fusiona ramas y no promueve artefactos.
- Las rutas y errores internos se muestran completos solo en vistas humanas de diagnóstico.

## Criterios de aceptación

1. Dado un trabajo en cola, `status` devuelve su posición actual.
2. Dado un trabajo que termina entre el snapshot y la suscripción, `wait` retorna terminal sin agotar timeout.
3. Abortar `wait` deja el trabajo ejecutándose.
4. Un resultado `pending` es visible mediante comando humano y bloqueado mediante tool.
5. Tras `approve`, la tool puede devolverlo y registrar consumo.
6. Dos consumos con el mismo `requestId` incrementan el contador una sola vez.
7. Un resultado mayor de 64 KiB se trunca en tool y conserva hash y longitud.
8. Cerrar y reabrir Pi conserva revisión y consumo.
9. Listados paginados no repiten ni omiten trabajos si no se insertan trabajos entre páginas.
10. Una base del esquema de fase 00 migra sin perder jobs, cola, resultados ni notificaciones; una fixture histórica v1 conserva esos datos al recorrer primero la migración de fase 00.

## Pruebas

- Unitarias: filtros, cursores, normalización, límites, códigos de error.
- Integración Durable: consulta, consumo y revisión tras reapertura.
- Carreras: terminar antes, durante y después de instalar la espera.
- Propiedad: paginación estable para secuencias arbitrarias de timestamps repetidos.
- Seguridad: ninguna tool filtra resultado pendiente/rechazado.
- Compatibilidad: comandos actuales mantienen formato suficiente para usuarios existentes.

## Entregables documentales

- README con nuevos comandos y tools.
- Arquitectura con servicio de consultas y política de revisión.
- Tabla de ampliación/migración desde el esquema de fase 00 y prueba de la ruta histórica v1 → fase 00 → fase 01.
