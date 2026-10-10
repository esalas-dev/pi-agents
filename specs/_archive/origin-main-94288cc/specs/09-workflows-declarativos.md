# 09 — Workflows declarativos y recuperables

## Estado y dependencias

Propuesta. Depende de todas las capacidades 01–08.

## Objetivo

Componer jobs, gates, grupos, joins y aprobaciones mediante un formato declarativo versionado que pueda validarse antes de ejecutar y reanudarse sin evaluar JavaScript arbitrario.

## Decisión de diseño

V1 usa YAML/JSON declarativo. No ejecuta `eval`, `Function`, `node:vm` ni módulos aportados por el workflow. La expresividad se limita deliberadamente para favorecer:

- recuperación determinista;
- auditoría;
- validación estática;
- límites de fan-out;
- separación de aprobación;
- menor superficie de seguridad.

## Ubicaciones

- proyecto: `.pi/workflows/<name>.yaml`, solo con proyecto confiado;
- usuario: `~/.pi/agent/workflows/<name>.yaml`;
- definición inline por tool/RPC: deshabilitada por defecto para modelos y limitada a humanos/extensiones confiables.

Proyecto reemplaza usuario por `metadata.name`. Symlinks y traversal se rechazan.

## Esquema V1

```yaml
apiVersion: pi-agents/v1
kind: Workflow
metadata:
  name: review-change
  description: Revisión paralela y verificación
spec:
  inputs:
    target:
      type: string
      required: true
  limits:
    maxJobs: 20
    maxParallel: 4
    timeout: 30m
  steps:
    - id: reviewers
      type: fanout
      items: [security, correctness, tests]
      agent: reviewer
      task: "Revisa {{ inputs.target }} con foco en {{ item }}"

    - id: join_reviews
      type: join
      needs: [reviewers]
      condition: all

    - id: tests
      type: gate
      needs: [join_reviews]
      command: ["node", "--test"]

    - id: approval
      type: approval
      needs: [tests]
      prompt: "Revisar hallazgos y decidir promoción externa"
```

## Tipos de paso V1

### `agent`

Crea un job con snapshot normal. Puede declarar output schema, gates e isolation. Produce una referencia a job y resultado estructurado aprobado cuando corresponda.

### `fanout`

Crea un grupo y un job por item de una lista acotada. La lista puede ser literal o proceder de un resultado estructurado anterior mediante una ruta JSON segura. No interpreta texto libre como lista.

### `join`

Usa la semántica de fase 05. Produce un manifiesto de IDs y estados, no síntesis.

### `gate`

Usa fase 04. Puede ejecutar como verificación del workflow en cwd principal o worktree explícitamente referenciado. Debe declarar esa elección; no infiere cwd.

### `approval`

Pausa el workflow y crea una solicitud humana. Decisiones: `approve`, `reject`, `request_changes`. Ningún modelo puede resolverla. `request_changes` no crea bucles automáticamente en V1; la definición debe tener transición explícita soportada o terminar esperando intervención.

## Dependencias y grafo

- `needs` define un DAG.
- IDs únicos con patrón seguro.
- Se rechazan ciclos antes de persistir ejecución.
- Un paso se vuelve elegible cuando todos sus `needs` satisfacen la condición declarada.
- Fallo predeterminado: `fail_fast` para dependientes, sin cancelar hermanos ya activos.
- Política opcional `continue` permite ejecutar pasos que acepten estados fallidos; debe declararse.

## Interpolación

Sintaxis restringida `{{ ... }}`. Rutas permitidas:

- `inputs.<name>`;
- `steps.<id>.status`;
- `steps.<id>.structured.<json-path-seguro>`;
- `item` e `index` dentro de fanout.

No hay expresiones, llamadas, acceso a prototipos, variables de entorno ni filesystem. Valores se escapan como datos; para argv cada placeholder produce un argumento, no texto shell.

## Límites

Máximos predeterminados y duros:

- 100 pasos definidos;
- 1000 jobs por ejecución, configurable a menor valor;
- 4096 items de fanout como techo absoluto, 100 predeterminado;
- 16 jobs paralelos, limitado además por concurrencia global;
- profundidad de inclusión 1 en V1;
- tamaño de definición 256 KiB;
- timeout total máximo 7 días.

V1 puede omitir inclusión de workflows; si se implementa, solo referencias por nombre, sin recursión.

## Persistencia

`WorkflowsDoc`:

```ts
interface WorkflowRun {
  id: string;
  definitionName: string;
  definitionHash: string;
  apiVersion: string;
  status: "validating" | "running" | "waiting_approval" |
    "completed" | "failed" | "cancelled" | "timed_out";
  inputs: JsonValue;
  steps: Record<string, StepRun>;
  createdAt: number;
  updatedAt: number;
  createdBy: Actor;
  limits: EffectiveLimits;
}
```

Se persiste una copia normalizada de la definición con el run. Editar el YAML no altera ejecuciones existentes. Un rerun crea otro ID y puede usar la definición nueva.

Cada paso tiene requestId determinista `workflow:<run-id>:<step-id>:<item-index>`. Los jobs y grupos guardan `workflowId`/`stepId`.

## Scheduler del workflow

El reconciliador:

1. carga run y pasos;
2. deriva pasos elegibles;
3. reserva ejecución de paso en commit;
4. crea operación hija con requestId determinista;
5. enlaza ID;
6. observa terminales por consulta/eventos;
7. actualiza paso y repite.

Eventos aceleran; snapshots garantizan corrección. Reabrir no depende de listeners previos.

## Aprobación

Un paso `approval` contiene:

- resumen y referencias a resultados;
- estado `pending|approved|rejected|changes_requested`;
- actor humano;
- instante y motivo;
- hash del conjunto revisado.

Si cambia algún artefacto después de aprobar, la aprobación queda obsoleta y debe repetirse. Aprobar workflow permite continuar sus pasos declarados, pero nunca fusiona ramas o publica artefactos salvo que una futura especificación de promoción lo defina con autoridad separada.

## Interfaces

### Comandos

```text
/subagents workflow validate <nombre|ruta>
/subagents workflow run <nombre> --input clave=valor
/subagents workflow status <run-id>
/subagents workflow approve <run-id> <step-id> [--reason <texto>]
/subagents workflow reject <run-id> <step-id> [--reason <texto>]
/subagents workflow cancel <run-id>
/subagents workflow rerun <run-id>
```

### Tool/RPC

- Tool puede validar/iniciar solo workflows previamente confiados y permitidos.
- Tool no puede aprobar/rechazar.
- RPC approval deshabilitado por defecto, igual que fase 03.
- Eventos incluyen progreso, no contenidos completos.

## Seguridad

- Validación completa antes de crear el run.
- Proyecto debe estar confiado para cargar definiciones locales.
- No hay JavaScript arbitrario ni shell implícito.
- Gates y agentes conservan sus propias políticas.
- Fanout de datos externos aplica límites antes de crear jobs.
- Secrets no aparecen en eventos; inputs sensibles requieren futura integración de secretos.

## Errores

- `WORKFLOW_DEFINITION_INVALID`
- `WORKFLOW_VERSION_UNSUPPORTED`
- `WORKFLOW_CYCLE`
- `WORKFLOW_LIMIT_EXCEEDED`
- `WORKFLOW_INPUT_INVALID`
- `WORKFLOW_INTERPOLATION_INVALID`
- `WORKFLOW_STEP_FAILED`
- `WORKFLOW_APPROVAL_REQUIRED`
- `WORKFLOW_APPROVAL_STALE`

## Criterios de aceptación

1. Una definición inválida no crea jobs ni grupos.
2. Un run captura definición e inputs y no cambia al editar YAML.
3. Reabrir en cualquier paso continúa sin duplicar hijos.
4. Fanout solo consume arrays estructurados y respeta límites.
5. Join no sintetiza resultados.
6. Approval solo puede resolverlo un actor humano permitido.
7. Modificar el artefacto revisado invalida aprobación.
8. Cancelar run usa control durable y conserva evidencia.
9. No existe vía de ejecución JavaScript o shell implícito.
10. Rerun crea historial nuevo y enlazado.

## Pruebas

- Validación de esquema, ciclos, IDs y límites.
- Interpolación segura y ataques de prototype/path traversal.
- Recuperación antes/después de reservar cada tipo de paso.
- Fanout grande y concurrencia.
- Approval, rechazo y obsolescencia.
- Gates y worktrees integrados.
- Cancelación con hijos en estados variados.
- Migración desde fase 08.

## Fuera de alcance

- Scripts JavaScript compatibles con Claude Code.
- Bucles arbitrarios, recursión y mutación dinámica del DAG.
- Promoción automática.
- Marketplace de workflows.
