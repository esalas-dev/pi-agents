# Feature Specification: Consulta, listado y espera

**Feature Branch**: `001-consulta-listado-espera` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: completada según roadmap e informe de aceptación

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/01-consulta-listado-espera.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consultar y recuperar trabajos con revisión separada (Priority: P1)

Consultar, listar, esperar y recuperar resultados sin cancelar trabajos al terminar la espera.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** se consulta o espera un trabajo que termina y se solicita su resultado,
   **Then** la espera observa el estado durable y el acceso respeta revisión, consumo e idempotencia.
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

- **FR-001**: El sistema DEBE listar por cursor keyset estable y consultar estado sin materializar cuerpos de resultados.
- **FR-002**: El sistema DEBE esperar con snapshot → suscripción → snapshot; timeout o aborto de espera no cancelan el job.
- **FR-003**: El sistema DEBE separar revisión humana de consumo idempotente y truncar salidas de tools a 64 KiB con hash y tamaño.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- Job y vistas query/list relacionan identidad y estado sin cuerpos grandes.
- Resultado, revisión humana y consumo mantienen documentos y estados separados.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Objetivo

Ofrecer una API común y durable para consultar un trabajo, listar trabajos de la sesión, esperar su terminación y recuperar su resultado sin convertir una espera cancelada en cancelación del trabajo.

Esta fase separa tres conceptos:

1. observar estado;
2. esperar un cambio;
3. exponer o consumir el resultado.

### Fuera de alcance

- Cancelar, pausar o reintentar: especificación 02.
- Consultar todas las sesiones o abrir sus SQLite simultáneamente.
- Reinyectar automáticamente resultados al modelo principal.
- Aprobar o fusionar cambios producidos por el trabajo.
- Streaming de tokens o logs en vivo.

### Requisitos funcionales

#### RF-01 — Consulta por ID

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

#### RF-02 — Listado de sesión

Debe existir `listJobs(filter)` limitado al SQLite de la sesión principal activa. Filtros:

- uno o varios estados públicos;
- nombre de agente;
- creados antes/después de un instante;
- solo pendientes de revisión;
- límite entre 1 y 100, predeterminado 20;
- cursor opaco para paginación.

Orden predeterminado: `createdAt` descendente y `id` como desempate. El cursor no puede depender de índices de arreglo volátiles.

#### RF-03 — Espera acotada

`waitForJob(id, options)` espera hasta:

- estado terminal;
- estado solicitado en `until`;
- timeout;
- aborto de la llamada por el usuario.

Cancelar la espera **no** cancela ni modifica el trabajo. El timeout permitido será de 0 a 300 segundos; `0` equivale a consulta inmediata. La espera debe comprobar primero el snapshot durable para evitar perder una transición ocurrida antes de registrar el listener.

#### RF-04 — Recuperación de resultado

Un resultado terminal debe poder recuperarse sin mutarlo. Se distinguen:

- `peek`: lectura humana que no marca consumo;
- `consume`: lectura por un consumidor identificado, que persiste un recibo de consumo (`consumedAt`, `consumedBy`, `consumeRequestId`) en el ledger y actualiza el agregado de consumo.

Repetir `consume` con el mismo `requestId` es idempotente. Un consumidor distinto puede leer el resultado, pero el historial de consumo debe conservar al menos el primer y último consumo sin crecimiento ilimitado.

#### RF-05 — Revisión humana

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

#### RF-06 — Límites de salida

Una tool devolverá como máximo 64 KiB de respuesta textual. Si el resultado excede el límite debe incluir:

- prefijo truncado;
- longitud total;
- `sha256` del contenido completo;
- indicador `truncated: true`;
- instrucción para consulta humana completa.

El contenido completo permanece en SQLite; no se creará un archivo temporal salvo solicitud futura.

### Contratos de interfaz

#### Comandos

```text
/subagents status <id>
/subagents result <id>
/subagents list [--status <estado>] [--limit <n>]
/subagents wait <id> [--timeout <segundos>]
/subagents approve <id> [--reason <texto>]
/subagents reject <id> [--reason <texto>]
```

`result` es una vista humana y no añade contenido al contexto del modelo.

#### Tools

- `pi_agents_status({ id })`
- `pi_agents_list({ statuses?, agent?, limit?, cursor?, pending_review? })`
- `pi_agents_wait({ id, until?, timeout_seconds? })`
- `pi_agents_result({ id, consume?, request_id? })`

No se añadirá un parámetro de aprobación a ninguna tool.

### Modelo persistente

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

`JobRecord` conserva `createdBy?: Actor` para fijar la política de revisión y el índice conserva `reviewStatus` y `hasResult`. La migración 2→3 crea revisión `not_required` y consumo vacío para jobs existentes. Jobs nuevos iniciados por `model` o RPC reciben `pending`; los iniciados por `human` reciben `not_required`, salvo política futura explícita.

`requestIds` puede limitarse a los últimos 32 IDs para consulta del historial reciente. La autoridad de deduplicación es el ledger durable, ampliado con operaciones tipadas `start`, `consume` y `review`; cada recibo de `consume` conserva `consumedAt`, `consumedBy` y `consumeRequestId`. Expulsar un ID del historial reciente no permite ejecutar de nuevo la misma solicitud. Recibo, consumo y decisión se actualizan en un único commit.

### Consistencia y recuperación

- La consulta siempre lee un snapshot Durable; no usa el objeto devuelto originalmente por `start`.
- La espera usa el patrón «leer, suscribir, volver a leer» para cerrar la carrera entre snapshot y listener.
- El consumo se confirma en el mismo commit que incrementa su contador.
- Una caída después de devolver el resultado pero antes del commit puede producir una segunda entrega. El cliente debe aportar `requestId`; sin él se documenta semántica al menos una vez.
- Reabrir la sesión reconstruye cualquier espera desde el estado, no persiste promesas.

### Errores estables

- `JOB_NOT_FOUND`
- `INVALID_FILTER`
- `WAIT_TIMEOUT`
- `WAIT_ABORTED`
- `RESULT_NOT_READY`
- `RESULT_REVIEW_REQUIRED`
- `RESULT_REJECTED`
- `REQUEST_ID_CONFLICT`

Timeout y aborto de espera no se marcan como error del trabajo.

### Seguridad y control humano

- Los listados compactos no incluyen tarea ni resultado por defecto.
- Los resultados pendientes o rechazados no llegan completos al modelo.
- Una aprobación registra actor, instante y motivo; no cambia el estado técnico del trabajo.
- Aprobar un resultado no ejecuta comandos, no fusiona ramas y no promueve artefactos.
- Las rutas y errores internos se muestran completos solo en vistas humanas de diagnóstico.

### Entregables documentales

- README con nuevos comandos y tools.
- Arquitectura con servicio de consultas y política de revisión.
- Tabla de ampliación/migración desde el esquema de fase 00 y prueba de la ruta histórica v1 → fase 00 → fase 01.
- Plan de implementación aprobado antes de modificar código.

### Decisiones aprobadas de diseño

- La consulta se implementa como una capa de aplicación sobre el repositorio de fase 00; los adaptadores no replican la máquina de estados.
- `JobsIndexDoc` se usa como proyección compacta para filtros y cursores; el cursor opaco codifica `(createdAt,id)` descendente y no depende de `order`.
- La espera usa `watchDoc` con el patrón snapshot → suscripción → snapshot; timeout y aborto afectan únicamente a la espera.
- Las tools no pueden aprobar resultados ni obtener cuerpos `pending`/`rejected`; la aprobación es comando TUI con actor humano.
- El límite de tool es 64 KiB de texto; el resultado completo continúa en SQLite y el prefijo incluye longitud, SHA-256 e indicador de truncado.
- El resultado humano es `peek` por defecto. `consume` exige `requestId` para deduplicación fuerte y registra consumidor, contador y timestamps.
- La migración 2→3 requiere mantenimiento explícito y bloqueo del runtime mientras no finalice.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Criterios de aceptación

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

### Pruebas

- Unitarias: filtros, cursores, normalización, límites, códigos de error.
- Integración Durable: consulta, consumo y revisión tras reapertura.
- Carreras: terminar antes, durante y después de instalar la espera.
- Propiedad: paginación estable para secuencias arbitrarias de timestamps repetidos.
- Seguridad: ninguna tool filtra resultado pendiente/rechazado.
- Compatibilidad: comandos actuales mantienen formato suficiente para usuarios existentes.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.
