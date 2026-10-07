# Arquitectura de `pi-agents`

## Objetivo y frontera

La extensión ofrece dos entradas al mismo coordinador:

```text
/subagents ─┐
           ├─ resolver agente/modelo → JobsDoc → cola → conversación Durable
pi_agents ──┘                                      └─ envío → generación/herramientas
                                                             └─ resultado → notificación Pi
```

Cada trabajo ejecuta una tarea independiente. No existen cadenas ni lotes. La conversación Durable mantiene un transcript separado de la sesión principal y hereda únicamente cwd, modelo o modelo declarado, nivel de razonamiento, herramientas permitidas e instrucciones del agente.

## Componentes

### Extensión Pi (`index.ts` y adaptadores)

`index.ts` solo conecta bindings públicos del host. `src/adapters/pi/resolve.ts` resuelve agente, confianza, proveedor y snapshot; `display.ts` presenta vistas compactas; `register.ts` registra comandos, tool, renderers y lifecycle sin poseer transiciones Durable.

- Registra el comando, la herramienta y renderers de entradas.
- Abre recursos solo desde `session_start`, no durante la carga de la fábrica.
- Cierra el runtime desde `session_shutdown`; su propietario libera coordinador, Harness y lease.
- Consulta la confianza mediante la API nativa.
- Construye un `ModelRuntime` público y sincroniza proveedores físicos visibles en `ctx.modelRegistry`.
- Añade notificaciones fuera del contexto del modelo mediante `pi.appendEntry()`.

### Descubrimiento (`src/agents.ts`)

Busca:

1. `<agent-dir>/agents`;
2. el `.pi/agents` más cercano al cwd, únicamente si el proyecto está confiado.

Los archivos se ordenan por nombre para que la resolución sea determinista. Primero se insertan los personales y después los de proyecto, produciendo reemplazo por `name`.

### Registro, cola, consulta y control (esquemas 2, 3 y 4)

La persistencia separa `StorageMetaDoc`, `JobsIndexDoc`, `JobDocFamily`, `JobResultDocFamily` y `RequestLedgerDocFamily`. En el esquema 3 también separa `JobReviewDocFamily` y `JobConsumptionDocFamily`; el esquema 4 añade `JobControlDocFamily`, `controlHistory`, campos de intento y estados de ciclo de vida. El índice contiene orden y resúmenes compactos; el cuerpo del job y la respuesta se leen por separado. El ledger conserva `requestId`, actor, hash canónico y recibo de la operación (`start`, `consume`, `review`, `control` o `retry`). Las mutaciones de cola y control actualizan job, índice, ledger e historial en el mismo commit.

`QueryService` implementa `getJob` y `listJobs` sobre snapshots Durable. El listado filtra la proyección compacta y usa un cursor keyset opaco de `(createdAt,id)` descendente; no depende del arreglo de orden de cola y no materializa `JobResultDocFamily`. La vista de resultado se carga aparte mediante `ResultService`.

`WaitService` aplica snapshot → `watchDoc` → snapshot. El timeout y `AbortSignal` solo terminan la promesa de espera; nunca llaman una API de cancelación del Harness. El estado Durable sigue siendo la autoridad tras cerrar y reabrir Pi.

El documento conserva la definición resuelta del agente, no solo su nombre. Un trabajo que espera en cola no cambia si el archivo Markdown se modifica antes de comenzar.

La cola cuenta `provisioning` y `running` contra el límite. El `Coordinator` serializa decisiones dentro del proceso y los commits Durable serializan las mutaciones persistentes.

### Conversación por trabajo

Cada trabajo crea una conversación `ownerless` mediante `DurableExecution` con los documentos internos de Pi Durable. Se configura en el mismo commit con:

- modelo;
- nivel de razonamiento;
- extensión `CodingTools`;
- filtro exacto de herramientas;
- instrucciones;
- cwd.

No se utiliza la conversación reservada raíz y no se comparte transcript entre trabajos.

## Máquina de estados

```text
queued
  │ commit: crear/configurar conversación y retirar de queue
  ▼
provisioning
  │ submit(requestId = "pi-agents:<job-id>")
  │ commit: guardar submissionId y startedAt
  ▼
running
  │ Submission.wait()
  ├──────── respuesta ────────▶ completed
  ├──────── error terminal ───▶ failed
  └──────── intención cancel ─▶ cancelling ── aborto confirmado ─▶ cancelled

queued ── pause ──▶ paused ── resume ──▶ queued
queued/paused ── cancel ──▶ cancelled
retry terminal ──▶ nuevo queued enlazado por `retryOf`
```

`interrupted` está reservado en el protocolo público para resultados irreanudables o cancelaciones inciertas. El cierre normal no convierte trabajos en interrumpidos: Pi Durable deja las tareas pendientes y las reconcilia al reabrir. La pausa activa devuelve `PAUSE_ACTIVE_UNSUPPORTED`; no se simula con un flag.

## Ventanas de caída

| Punto de caída | Recuperación |
|---|---|
| Después de crear el job `queued` | El `pump` lo vuelve a seleccionar. |
| Después de crear la conversación | El ID quedó en `provisioning`; se reutiliza. |
| Después de admitir el envío, antes de guardar `submissionId` | Se repite `submit()` con el mismo `requestId`; retorna el envío existente. |
| Durante modelo o herramienta | El scheduler Durable reanuda desde su checkpoint. |
| Después del resultado, antes de cambiar el job | `Submission.wait()` devuelve el resultado ya durable y se completa el job. |
| Después de completar el job, antes de notificar | En `session_start` se buscan terminales con `notified: false`. |
| Después de añadir la notificación, antes de marcarla | Se busca el job ID entre las entradas de la rama activa y se evita duplicarla. |

La última deduplicación cruza dos almacenes —la sesión Pi y SQLite Durable— y por ello no puede ser una transacción única. El job ID convierte la recuperación en una comprobación idempotente.

## Concurrencia

Pi Durable no expone un límite global de scheduler. La extensión lo aplica antes de admitir conversaciones:

- solo los primeros `N` jobs pasan de `queued` a `provisioning`;
- terminar un monitor vuelve a ejecutar el `pump`;
- al reabrir, los jobs activos ocupan sus slots antes de seleccionar la cola.

De esta forma no se reservan muchas tareas Durable que aparenten estar ejecutándose mientras esperan un semáforo volátil.

## Persistencia por sesión principal

El archivo usa el ID de la sesión Pi. Una base de esquema 2 no abre el Harness: mantenimiento TUI, autorización humana y backup verificado deben completar 2 → 3; una base de esquema 3 requiere después 3 → 4. Ambas migraciones son explícitas y atómicas. Esto aporta:

- `status` y `result` con semántica local a la conversación principal;
- notificaciones dirigidas a la sesión que inició el trabajo;
- pausa natural al cambiar de sesión;
- menor probabilidad de que dos procesos Pi abran el mismo almacenamiento.

No hay índice global de jobs en esta versión. Las consultas se limitan al SQLite de la sesión activa.

## Modelo y proveedores

`ExtensionContext` expone `ModelRegistry`, pero no el `ModelRuntime` completo requerido por Pi Durable. Acceder a su campo privado infringiría el contrato público. La extensión crea otro `ModelRuntime` con `auth.json` y `models.json`, y registra mediante `registerNativeProvider()` los proveedores físicos publicados por el registro principal.

Esto mantiene autenticación y proveedores ordinarios sin depender de internals. Una definición de modelo virtual no se puede extraer públicamente del registro, por lo que esos modelos se rechazan cuando no aparecen en el runtime durable.

## Herramientas

Además de `pi_agents` para admitir trabajos, la extensión registra `pi_agents_status`, `pi_agents_list`, `pi_agents_wait`, `pi_agents_result` y `pi_agents_control`. El comando expone `cancel`, `pause`, `resume` y `retry`. Estas tools delegan en `JobsService`; no implementan transiciones ni aprobación.

El esquema 3 protege los resultados con revisión separada: jobs iniciados por modelo o extensión quedan `pending` tras migración; una tool no recibe el cuerpo `pending` o `rejected`. `approve`/`reject` exige actor humano desde la TUI activa y solo cambia el documento de revisión. `peek` humano no marca consumo; `consume` exige `requestId` y actualiza ledger y agregado de consumo en el mismo commit.

Las tools truncan el texto a 64 KiB por bytes UTF-8 y devuelven longitud total, SHA-256 e indicador de truncado. El cuerpo completo permanece en SQLite.

Se instala únicamente `CodingTools` de Pi Durable:

- `read`
- `write`
- `edit`
- `bash`

No se conserva un `ExtensionToolContext` de la llamada original: su vida termina cuando la herramienta principal retorna. Por ello no sería correcto intentar invocar posteriormente `ctx.executeTool()` desde el trabajo de fondo.

Las herramientas Durable aplican sus políticas de replay. La cancelación activa persiste primero `control.pending` y el coordinador usa únicamente `Conversation.abort()`/`Harness.abortSubmission()`. Si el aborto no se puede confirmar, persiste `interrupted`; solo la confirmación publica `cancelled`. Efectos no seguros no se repiten ciegamente después de una caída.

## Seguridad

La tool de control exige `request_id`; los actores model no pueden controlar jobs humanos bajo la política predeterminada y la cancelación activa requiere autoridad TUI. La confianza del proyecto es una barrera de carga, no una sandbox. La extensión no lee `.pi/agents` cuando `ctx.isProjectTrusted()` es falso. Una vez autorizado, instrucciones y herramientas se ejecutan con los permisos del proceso anfitrión.

SQLite y las notificaciones pueden contener información sensible. No deben publicarse ni incorporarse al repositorio.
