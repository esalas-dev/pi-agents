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

### Registro y cola (esquema 2)

La persistencia separa `StorageMetaDoc`, `JobsIndexDoc`, `JobDocFamily`, `JobResultDocFamily` y `RequestLedgerDocFamily`. El índice contiene orden y resúmenes compactos; el cuerpo del job y la respuesta se leen por separado. El ledger conserva `requestId`, actor, hash canónico y recibo de admisión.

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
  └──────── error terminal ───▶ failed
```

`interrupted` está reservado en el protocolo público para resultados irreanudables. El cierre normal no convierte trabajos en interrumpidos: Pi Durable deja las tareas pendientes y las reconcilia al reabrir.

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

El archivo usa el ID de la sesión Pi. Esto aporta:

- `status` y `result` con semántica local a la conversación principal;
- notificaciones dirigidas a la sesión que inició el trabajo;
- pausa natural al cambiar de sesión;
- menor probabilidad de que dos procesos Pi abran el mismo almacenamiento.

No hay índice global de jobs en esta versión.

## Modelo y proveedores

`ExtensionContext` expone `ModelRegistry`, pero no el `ModelRuntime` completo requerido por Pi Durable. Acceder a su campo privado infringiría el contrato público. La extensión crea otro `ModelRuntime` con `auth.json` y `models.json`, y registra mediante `registerNativeProvider()` los proveedores físicos publicados por el registro principal.

Esto mantiene autenticación y proveedores ordinarios sin depender de internals. Una definición de modelo virtual no se puede extraer públicamente del registro, por lo que esos modelos se rechazan cuando no aparecen en el runtime durable.

## Herramientas

Se instala únicamente `CodingTools` de Pi Durable:

- `read`
- `write`
- `edit`
- `bash`

No se conserva un `ExtensionToolContext` de la llamada original: su vida termina cuando la herramienta principal retorna. Por ello no sería correcto intentar invocar posteriormente `ctx.executeTool()` desde el trabajo de fondo.

Las herramientas Durable aplican sus políticas de replay. Efectos no seguros no se repiten ciegamente después de una caída.

## Seguridad

La confianza del proyecto es una barrera de carga, no una sandbox. La extensión no lee `.pi/agents` cuando `ctx.isProjectTrusted()` es falso. Una vez autorizado, instrucciones y herramientas se ejecutan con los permisos del proceso anfitrión.

SQLite y las notificaciones pueden contener información sensible. No deben publicarse ni incorporarse al repositorio.
