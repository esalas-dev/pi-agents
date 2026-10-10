# Feature Specification: Resultados estructurados y gates

**Feature Branch**: `004-resultados-estructurados-gates` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: propuesta bloqueada; sin plan aprobado

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/04-resultados-estructurados-gates.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Verificar una salida estructurada y sus gates (Priority: P1)

Validar JSON Schema y ejecutar verificaciones deterministas sin equiparar éxito técnico con aprobación.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** un job produce salida estructurada y se ejecutan sus verificaciones,
   **Then** se conserva la respuesta y la validación, se distinguen fallos de gate y no se aprueba automáticamente.
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

- **FR-001**: El sistema DEBE validar el resultado estructurado y permitir como máximo una corrección; rechazar referencias remotas antes de encolar.
- **FR-002**: El sistema DEBE ejecutar gates ordenados después de validar, con intent durable y salida acotada con hash.
- **FR-003**: El sistema DEBE recuperar gates inciertos como interrupted sin replay ciego; separar gate_failed de la revisión humana.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- Salida estructurada relaciona respuesta original, JSON Schema y estado de validación.
- Intent y registro de gate conservan comando, orden, resultado y evidencia acotada.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Objetivo

Permitir que un trabajo produzca un resultado validado contra JSON Schema y ejecute verificaciones deterministas posteriores sin confundir «el agente respondió» con «la verificación pasó».

### Conceptos

- **Respuesta textual**: salida normal del agente; siempre se conserva.
- **Resultado estructurado**: JSON validado; opcional.
- **Gate**: comando verificable ejecutado después de la respuesta.
- **Resultado técnico**: combinación de ejecución del agente, validación y gates.
- **Revisión humana**: decisión independiente; pasar gates no equivale a aprobación.

### Estados

Se mantienen los terminales existentes y se añaden fases internas:

```text
running
  └─▶ validating_output
        ├─ inválido ─▶ failed (STRUCTURED_OUTPUT_INVALID)
        └─ válido ─▶ gating
                       ├─ todos pasan ─▶ completed
                       ├─ alguno falla ─▶ gate_failed
                       └─ incierto ─▶ interrupted
```

`gate_failed` será estado público terminal. No se reutiliza `failed`, porque el agente sí pudo completar correctamente y la verificación aporta información distinta.

### Contrato de inicio

Las entradas de comando, tool y RPC aceptan opcionalmente:

```json
{
  "output_schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "findings": { "type": "array" }
    },
    "required": ["findings"]
  },
  "gates": [
    {
      "name": "tests",
      "command": ["node", "--test"],
      "timeout_seconds": 120,
      "expected_exit_codes": [0]
    }
  ]
}
```

Límites iniciales:

- schema serializado: 64 KiB;
- profundidad: 32;
- gates por trabajo: 8;
- argumentos por comando: 64;
- timeout por gate: 1–1800 s;
- salida conservada por stream: 1 MiB, con truncado y hash.

Se prefiere `command: string[]` para evitar shell implícito. Un modo shell requiere `{ "shell": true, "command": "..." }`, debe estar deshabilitado por defecto para callers modelo/RPC y mostrar advertencia humana.

### Resultado estructurado

#### Estrategia

Antes de implementar se verificará si Pi Durable expone una tool de salida estructurada o constrained sampling mediante API pública. Orden de preferencia:

1. tool dedicada obligatoria y validación de su payload;
2. constrained sampling público;
3. extracción estricta de un único documento JSON de la respuesta final.

No se accederá a APIs privadas. Si se usa extracción, texto antes o después del JSON invalida el resultado, salvo que la especificación adopte explícitamente un envelope delimitado.

#### Validación

- Draft: JSON Schema 2020-12 o el subconjunto soportado por la biblioteca seleccionada.
- La implementación debe documentar keywords no soportadas.
- No se permite resolver `$ref` remoto.
- `$ref` local se limita al mismo documento.
- Se rechazan valores no JSON, ciclos, números no finitos y prototipos exóticos.
- El JSON validado se persiste separadamente de la respuesta textual.

#### Corrección

V1 permite como máximo un turno adicional de corrección cuando el payload es inválido. La solicitud de corrección y el segundo payload quedan en el transcript. Si continúa inválido, el trabajo falla; no se retorna un objeto parcialmente validado.

### Gates

#### Orden

Los gates se ejecutan secuencialmente en el orden declarado. La primera falla detiene los restantes por defecto. Opción futura `continueOnFailure` queda fuera de V1.

#### Directorio

- Sin worktree: cwd del trabajo.
- Con worktree de fase 06: cwd equivalente dentro del worktree.
- Nunca se cambia silenciosamente al cwd principal si el worktree falta.

#### Registro

Cada gate persiste:

- nombre y argv;
- cwd normalizado;
- estado `pending|running|passed|failed|interrupted|timed_out`;
- requestId determinista `gate:<job-id>:<index>`;
- inicio/fin/duración;
- exit code y señal;
- stdout/stderr truncados, tamaños y hashes;
- versión/configuración efectiva.

#### Seguridad de replay

Un comando externo no participa necesariamente en la transacción SQLite. Antes de ejecutar se registra `running`. Después se registra el resultado.

Si el proceso cae en medio:

- no se repite automáticamente el gate;
- se marca `interrupted` al reconciliar;
- una autoridad debe usar retry del trabajo o una operación futura de retry-gate;
- no se asume que exitió o no tuvo efectos.

Si Pi Durable ofrece ejecución de comandos con política de replay explícita, puede usarse, pero debe conservar esta semántica para herramientas inseguras.

### Modelo persistente

```ts
outputContract?: {
  schema: JsonValue;
  schemaHash: string;
  mode: "tool" | "constrained" | "strict-json";
  maxCorrectionTurns: number;
};
structuredResult?: {
  value: JsonValue;
  validatedAt: number;
  schemaHash: string;
};
gates?: GateRecord[];
technicalOutcome?: "agent_failed" | "output_invalid" | "gates_passed" |
  "gate_failed" | "gate_interrupted";
```

La configuración resuelta se captura al crear el job; cambios posteriores del caller no la alteran.

### Consulta y eventos

- `status` muestra fase, gate actual y conteo.
- `result` devuelve `structuredResult` solo bajo la política de revisión de 01.
- Eventos `job.output-validated`, `job.gate-started`, `job.gate-finished` contienen metadatos, nunca stdout/stderr completo.
- El evento terminal distingue `gate_failed`.

### Autoridad humana

- El agente no puede declarar que un gate pasó; solo el proceso registrado lo decide.
- Pasar todos los gates deja revisión `pending` cuando corresponde.
- Fallar un gate no borra la respuesta ni impide que un humano la inspeccione.
- Ningún gate fusiona ramas, publica artefactos o cambia estados de aprobación.
- Gates shell aportados por modelo requieren política explícita o aprobación previa.

### Errores

- `SCHEMA_UNSUPPORTED`
- `SCHEMA_TOO_LARGE`
- `STRUCTURED_OUTPUT_INVALID`
- `GATE_CONFIGURATION_INVALID`
- `GATE_FAILED`
- `GATE_TIMEOUT`
- `GATE_INTERRUPTED`
- `GATE_CWD_UNAVAILABLE`

### Fuera de alcance

- Generar automáticamente schemas desde TypeScript.
- Reintentar gates individualmente.
- Paralelizar gates.
- Promoción de artefactos.
- Interpretar salida de tests como aprobación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Criterios de aceptación

1. Un JSON válido se persiste y sobrevive reapertura.
2. Un payload inválido recibe como máximo una corrección y luego falla de forma determinista.
3. `$ref` remoto se rechaza antes de encolar.
4. Los gates no comienzan antes de validar la salida estructurada.
5. Un exit code inesperado produce `gate_failed`, no `failed` genérico.
6. Una caída durante gate produce `interrupted` y nunca reejecución ciega.
7. stdout/stderr grandes se truncan con hash y tamaño original.
8. Pasar gates no aprueba el resultado.
9. Un resultado pendiente no se filtra por eventos ni RPC.
10. Retry crea otro job con la misma configuración capturada.

### Pruebas

- Corpus de schemas válidos, inválidos, profundos y con refs.
- Payloads con prose extra, números no finitos y tamaños límite.
- Gates exitosos, exit code, señal, timeout y cwd ausente.
- Caída antes, durante y después de ejecutar el comando.
- Worktree simulado para verificar cwd.
- Política de shell por actor.
- Migración desde fase 03.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Propuesta bloqueada. No hay plan ni tareas aprobados y no se generan en esta migración.
