# Feature Specification: Grupos y join durable

**Feature Branch**: `005-grupos-join` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: propuesta bloqueada; sin plan aprobado

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/05-grupos-join.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Esperar un conjunto de trabajos sin síntesis automática (Priority: P1)

Coordinar membresía durable y condiciones de join sin lanzar otro modelo para sintetizar resultados.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** se sella un grupo y se espera una condición que vence durante el cierre,
   **Then** al reabrir se evalúa la condición durable y se obtiene un manifiesto, no una síntesis automática.
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

- **FR-001**: El sistema DEBE persistir membresía y job.groupId atómicamente y sellar el grupo de forma idempotente.
- **FR-002**: El sistema DEBE evaluar all, success, any y quorum con deadlines persistidos y límites de membresía.
- **FR-003**: El sistema DEBE abortar join sin modificar jobs; separar cancelación de grupo y miembros, sin síntesis ni aprobación automática.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- `GroupRecord` conserva membresía, condición y sellado; cada job conserva groupId.
- Join/deadline conserva condición y evaluación durable; el resultado es un manifiesto.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Objetivo

Coordinar varios trabajos como un conjunto durable, esperar condiciones de terminación y recuperar un manifiesto de resultados sin pedir automáticamente a otro modelo que los sintetice.

### Casos de uso

- Fan-out de revisores independientes.
- Esperar todas las comprobaciones de un cambio.
- Continuar cuando haya un resultado válido (`any`).
- Exigir un quórum mínimo.
- Consultar resultados parciales y stragglers.

### No objetivos

- Crear un lenguaje de workflows: fase 09.
- Sintetizar resultados con un modelo.
- Compartir transcript entre trabajos.
- Cancelar automáticamente perdedores de `any`; podrá solicitarse explícitamente.
- Grupos entre distintas sesiones SQLite.

### Ciclo de vida de grupo

```text
open ──seal──▶ sealed ──condición satisfecha──▶ completed
  │              │
  └─cancel───────┴────────────────────────────▶ cancelled
                 └─timeout terminal opcional──▶ timed_out
```

Un grupo `open` acepta miembros. `sealed` fija su membresía. `join` terminal requiere grupo sellado, salvo `any`, que puede completarse antes si la configuración lo permite. Predeterminado: se sella explícitamente.

### Condiciones de join

```text
all       todos los miembros terminales
success   todos terminales y todos técnicamente exitosos
any       al menos uno cumple successPredicate
quorum    N miembros cumplen successPredicate
```

`successPredicate` V1:

- `completed`;
- `completed_or_gate_failed`;
- `review_approved`.

`review_approved` permite separar finalización técnica de aceptación humana. El predicado se captura al crear el grupo.

### Requisitos funcionales

#### RF-01 — Creación

`createGroup` recibe nombre opcional, condición, quórum, timeout y actor. Devuelve `psg_<id>`. Nombre máximo 128 caracteres; no es identidad.

#### RF-02 — Membresía

Un job puede pertenecer como máximo a un grupo V1. Se añade:

- al iniciar con `groupId`; o
- mediante `addMember` mientras el job está `queued` y el grupo `open`.

No se añade un job activo o terminal para evitar reconstrucciones ambiguas, salvo una operación humana de importación futura fuera de alcance.

#### RF-03 — Sellado

Sellar es idempotente y persiste:

- lista ordenada de miembros;
- conteo esperado;
- hash de configuración;
- instante y actor.

Un grupo vacío no puede sellarse.

#### RF-04 — Estado derivado

El estado se calcula desde jobs y decisiones de revisión; no se mantienen contadores sin mecanismo de reconciliación. Pueden existir índices/caches, pero se reconstruyen al abrir.

#### RF-05 — Join

`join(groupId, waitOptions)` retorna:

- estado del grupo;
- condición y progreso;
- miembros por estado;
- IDs de resultados disponibles;
- razón de terminación;
- miembros pendientes.

No incluye cuerpos completos. El caller usa `pi_agents_result` y respeta revisión.

Cancelar una espera de join no cancela grupo ni miembros.

#### RF-06 — Timeout

Dos modos:

- `wait_timeout`: afecta solo a una llamada, no al grupo.
- `group_deadline`: persistido; al vencer marca `timed_out` y no cancela miembros por defecto.

El deadline usa instante absoluto UTC. Al reabrir se evalúa antes de admitir nuevas acciones.

#### RF-07 — Cancelación de grupo

Cancelar grupo registra una intención. Política V1:

- el grupo pasa `cancelled`;
- los miembros siguen ejecutándose por defecto;
- opción humana `cancel_members: true` envía solicitudes de la fase 02 y registra sus resultados.

Tools modelo no pueden usar `cancel_members: true` salvo política explícita.

### Interfaces

#### Comandos

```text
/subagents group create --condition all [--name <texto>]
/subagents group add <group-id> <job-id>
/subagents group seal <group-id>
/subagents group status <group-id>
/subagents group join <group-id> [--timeout <s>]
/subagents group cancel <group-id> [--cancel-members]
```

#### Tool

Una tool `pi_agents_group` con `action` discriminada: `create`, `add`, `seal`, `status`, `join`, `cancel`. Operaciones mutantes exigen `request_id`.

#### RPC y eventos

RPC refleja las mismas acciones. Eventos:

- `group.created`
- `group.member-added`
- `group.sealed`
- `group.condition-met`
- `group.timed-out`
- `group.cancelled`

Incluyen IDs y conteos, no resultados.

### Modelo persistente

`GroupsDoc` versionado:

```ts
interface GroupRecord {
  id: string;
  name?: string;
  status: "open" | "sealed" | "completed" | "timed_out" | "cancelled";
  condition: "all" | "success" | "any" | "quorum";
  successPredicate: "completed" | "completed_or_gate_failed" | "review_approved";
  quorum?: number;
  memberIds: string[];
  createdAt: number;
  sealedAt?: number;
  terminalAt?: number;
  deadlineAt?: number;
  createdBy: Actor;
  terminalReason?: string;
}
```

`JobRecord.groupId` debe coincidir con membresía. La escritura de ambos ocurre en un solo commit. Un reconciliador detecta divergencias antiguas o corrupción y falla cerrado.

### Concurrencia

Los grupos no crean un pool adicional. Cada job usa el límite global actual. Un fan-out grande queda en cola durable. Se impone un máximo inicial de 256 miembros por grupo.

### Recuperación

- Al abrir se recalculan condiciones de grupos no terminales.
- Si un job terminó antes de registrar el evento de grupo, la condición se detecta por snapshot.
- Si se alcanzó deadline con Pi cerrado, se marca `timed_out` al reabrir.
- Un evento duplicado no completa el grupo dos veces.
- Sellado y adición concurrentes se serializan; el commit que observa `sealed` rechaza el add.

### Control humano

- `success` técnico no equivale a revisión aprobada.
- La condición `review_approved` espera decisiones humanas.
- No existe sintetizador automático.
- Cancelar miembros requiere confirmación y queda auditado.
- Un join nunca fusiona ramas ni ejecuta comandos.

### Errores

- `GROUP_NOT_FOUND`
- `GROUP_NOT_OPEN`
- `GROUP_EMPTY`
- `GROUP_LIMIT_EXCEEDED`
- `GROUP_CONDITION_INVALID`
- `GROUP_QUORUM_INVALID`
- `JOB_ALREADY_GROUPED`
- `JOB_NOT_ELIGIBLE_FOR_GROUP`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Criterios de aceptación

1. Membresía y `job.groupId` se persisten atómicamente.
2. `all` no termina hasta que todos sean terminales.
3. `success` distingue `completed` de `gate_failed`.
4. `quorum` valida N contra membresía sellada.
5. Abortar join no modifica grupo ni trabajos.
6. Un deadline vencido mientras Pi estaba cerrado se aplica al reabrir.
7. Dos sellados con el mismo requestId son idempotentes.
8. Add concurrente posterior al sellado falla.
9. El manifiesto de join no filtra resultados completos.
10. `review_approved` no puede satisfacerse por decisión del agente.

### Pruebas

- Matriz de condiciones y combinaciones de estados.
- Grupos de 1, máximo y vacío.
- Carreras add/seal, terminal/deadline y cancel/completion.
- Reapertura con condiciones ya satisfechas.
- Paginación futura de miembros grandes.
- Cancelación opcional de miembros con fallos parciales.
- Migración desde fase 04.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Propuesta bloqueada. No hay plan ni tareas aprobados y no se generan en esta migración.
