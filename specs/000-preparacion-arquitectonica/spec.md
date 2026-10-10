# Feature Specification: Preparación arquitectónica

**Feature Branch**: `000-preparacion-arquitectonica` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: completada según el roadmap; aceptación documental contradictoria

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/00-preparacion-arquitectonica.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Migrar y recuperar la base durable sin perder trabajos (Priority: P1)

Preparar la base tipada y modular, migrar v1 con autorización y conservar el comportamiento público.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** la persona autoriza la conversión de una base v1 y vuelve a abrir la sesión,
   **Then** se conservan identidad, estados y resultados, y una versión desconocida se rechaza.
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

- **FR-001**: El sistema DEBE separar índice compacto, cuerpos de jobs, resultados y ledger en documentos Durable transaccionales.
- **FR-002**: El sistema DEBE migrar v1 al esquema 2 mediante mantenimiento humano con lease, backup verificado y conversión atómica.
- **FR-003**: El sistema DEBE conservar las entradas públicas, el inicio idempotente y la recuperación por sesión con tipado estricto.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- `JobsIndexDoc` resume cola y estados; `JobDocFamily` conserva identidad, tarea y snapshot.
- `JobResultDocFamily` conserva salida; `RequestLedgerDocFamily` conserva admisiones idempotentes.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Propósito y éxito

Preparar `pi-agents` para crecer sin concentrar persistencia, coordinación y presentación en un único administrador, ni cargar todas las respuestas para consultar un estado. El destinatario inicial es el usuario de la instalación local actual y quien mantenga sus fases siguientes.

El éxito consiste en conservar el comportamiento público existente, migrar bases v1 sin perder identidad ni estado y disponer de tipado, servicios compartidos, idempotencia y pruebas de recuperación. No consiste en implementar anticipadamente funciones 01–10.

#### Decisiones acordadas

- Rediseño completo del coordinador y adaptadores; no conservar `JobManager` como fachada obligatoria.
- Un SQLite por sesión, con documentos separados y transacciones comunes.
- Migración explícita por base, autorizada por humano y precedida por backup consistente.
- Compatibilidad inicial limitada al entorno inspeccionado, no a todos los mínimos históricos.
- Actores atribuidos por adaptadores; ningún argumento de tool concede identidad humana.
- Deduplicación del inicio por identidad de solicitud, sin añadir parámetros a la tool existente.
- Spec canónica en este directorio, no un segundo diseño paralelo en `docs/`.

#### Alternativas descartadas

| Alternativa | Motivo |
| --- | --- |
| Extracción incremental detrás de `JobManager` | Era la recomendación de menor riesgo, pero el usuario eligió reorganizar coordinador y adaptadores conjuntamente. |
| Solo tipado y pruebas, conservando el monolito | No satisface los gates de partición y migración del roadmap. |
| Migración automática al abrir | El usuario exige autorización por base. |
| Compatibilidad con los mínimos históricos | El usuario prioriza únicamente su entorno actual. |

### Alcance y frontera pública

Se conservan:

- `/subagents <agente> <tarea>`, `status <id>` y `result <id>`;
- tool `pi_agents({ agent, task })` y admisión inmediata de un job;
- descubrimiento personal/proyecto, confianza nativa, precedencia y herramientas permitidas;
- resolución y snapshot de agente/modelo, conversación `ownerless`, almacenamiento por sesión;
- estados públicos existentes y presentación de `provisioning` como `running`;
- límite de concurrencia, configuración de directorio de estado y deduplicación de notificaciones;
- resultados y notificaciones fuera del contexto del modelo principal.

Se añade únicamente una entrada pública de mantenimiento: `/subagents-storage migrate`, descrita más adelante. El cambio de política de entorno y la deduplicación del replay de la tool son cambios deliberados de esta fase.

Fuera de alcance: listado público, wait, revisión, consumo, cancel/pause/retry, RPC, eventos de integración/outbox, JSON Schema, gates, grupos, worktrees, steering, cron, workflows, panel TUI, retención/purga automática y promoción. Tampoco se soporta downgrade directo de una base migrada.

Las APIs TypeScript internas no son un contrato de compatibilidad: las pruebas pueden cambiar imports, pero deben conservar sus aserciones funcionales. No se introducirán interfaces genéricas sin un consumidor o una necesidad de prueba concreta.

### Base inspeccionada y límites de evidencia

| Elemento | Observación |
| --- | --- |
| Git | Baseline `efc690f`; árbol limpio al comenzar el diseño. |
| Plataforma | macOS, `darwin arm64`. |
| Node | `26.10.0`. |
| Pi instalado | `1.0.4`. |
| Pi Durable / Chord del proyecto | `1.0.1` / `1.0.1`. |
| YAML del manifiesto | `2.9.0`. |
| `pi-ai` local / incluido en Pi | `1.0.1` / `1.0.4`. |
| `npm run check` | Pasa; actualmente solo comprueba sintaxis, no tipos. |
| `npm test` | 9 pruebas pasan en el entorno local. |

La diferencia de `pi-ai` importa: Pi Durable `1.0.1` declara `pi-ai` como dependencia; las pruebas Node y los imports proporcionados por Pi no demuestran por sí solos una única resolución ni compatibilidad entre ambas versiones. No se ha probado aquí una migración, un backup/restauración ni el runtime rediseñado.

### Arquitectura propuesta

Los nombres de directorios siguientes son una organización objetivo, no archivos existentes ni una lista de tareas ejecutables.

| Unidad | Ubicación orientativa | Responsabilidad y dependencias |
| --- | --- | --- |
| Composición | `index.ts` | Conectar servicios y registrar la extensión. Sin transiciones de jobs. |
| Adaptadores Pi | `src/adapters/pi/` | Comandos, tool, renderers, contexto de actor, confianza y notificaciones. Dependen de servicios y API pública de Pi. |
| Aplicación | `src/application/` | Inicio, consulta actual, recuperación de resultado, confirmación de notificación y mantenimiento. Coordina dominio e infraestructura por contratos explícitos. |
| Dominio | `src/domain/` | Tipos, transiciones válidas, invariantes, intención canónica y errores. Sin TUI, SQLite o imports de Pi Durable. |
| Persistencia y ejecución Durable | `src/infrastructure/durable/` | Tokens, repositorios, unidad de trabajo y acceso público a conversaciones/submissions. |
| Mantenimiento SQLite | `src/infrastructure/storage/` | Propiedad de base, backup y apertura segura. No modifica tablas internas de Durable con SQL propio. |
| Runtime por sesión | `src/runtime/` | Lifecycle, concurrencia, recuperación y monitores; consume servicios, no replica reglas de estado. |
| Descubrimiento | `src/agents.ts` o módulo equivalente | Reutilizar la lógica existente y sus pruebas, sin refactor ajeno al objetivo. |

#### Interfaces y flujo

Los servicios cubrirán exclusivamente operaciones actuales: admitir trabajo, consultar estado, leer resultado, enumerar internamente terminales pendientes y confirmar notificación. Las vistas devueltas serán inmutables. El listado interno no expone la API de filtros/paginación de fase 01.

El adaptador entrega intención y actor. La aplicación comprueba el ledger, resuelve la configuración solo para una admisión nueva y confirma el job. El runtime reclama slots y coordina conversaciones. Al finalizar, confirma estado/resultado; el adaptador notifica y confirma la entrega por separado.

La unidad de trabajo debe permitir actualizar documentos y crear/configurar conversación en el mismo commit. No se crearán repositorios que impongan commits independientes por documento. El dominio no recibe un `Tx` de Pi Durable; el adaptador transaccional aplica sus decisiones.

El runtime tiene estados operativos de apertura, bloqueo por migración, listo y cierre, distintos de `JobStatus`. Un error de apertura no envenena permanentemente una cadena de promesas: una nueva solicitud puede reintentar después de resolver la causa. Cerrar es idempotente y libera recursos incluso si la apertura fue parcial.

### Modelo persistente

#### Versionado

Se introduce `storageSchemaVersion: 2` para el conjunto de documentos de la aplicación. No es la versión interna de SQLite, de Pi Durable ni la versión individual de cada token. Los tokens nuevos empiezan en versión 1. La fuente heredada es el token `pi-agents.jobs`, versión 1.

La siguiente fase ampliará este esquema mediante su propia migración; no reutilizará el significado de la conversión v1 → esquema 2.

#### Documentos

| Token / kind propuesto | Clave | Contenido |
| --- | --- | --- |
| `StorageMetaDoc` / `pi-agents.storage` | Singleton de sesión | Versión global, origen nuevo/migrado y recibo de migración completada. |
| `JobsIndexDoc` / `pi-agents.jobs-index` | Singleton de sesión | Cola FIFO y resúmenes compactos por job: ID, estado, nombre de agente, timestamps y flags de resultado/notificación. |
| `JobDocFamily` / `pi-agents.job` | ID de job | Tarea, cwd, snapshot de agente, modelo, thinking, estado, timestamps, IDs de conversación/submission, actor opcional y metadatos terminales. |
| `JobResultDocFamily` / `pi-agents.job-result` | ID de job | `finalResponse` y metadatos terminales necesarios para reconstruir el resultado actual. |
| `RequestLedgerDocFamily` / `pi-agents.request` | SHA-256 del `requestId` con namespace | ID original, operación, actor, versión/hash de canonización, instante y recibo compacto de admisión. |

El job es autoritativo para su estado. El índice es una proyección persistida actualizada en el mismo commit, nunca una segunda máquina de estados. El resultado es autoritativo para el cuerpo de respuesta. Duración, modelo efectivo y error terminal se reflejan en el job para conservar `status` sin cargar el cuerpo; el índice no incluye esos textos potencialmente grandes.

La familia de resultados existe solo si hay resultado. Una lectura no crea documentos ausentes. Los IDs heredados, timestamps, valores terminales y flag `notified` se conservan; un actor ausente significa desconocido, no `human` ni `system` inventado.

#### Invariantes

1. Cada job tiene exactamente una entrada de índice consistente.
2. La cola no tiene duplicados; contiene exactamente los jobs `queued`, en el orden conservado de admisión.
3. `provisioning` tiene conversación; `running` tiene conversación y submission.
4. Jobs terminales conservan su resultado; no se vuelven a encolar al abrir.
5. No hay tarea, system prompt ni cuerpo de respuesta en el índice.
6. La admisión crea job, índice/cola y recibo en el mismo commit.
7. Provisionar crea/configura conversación, cambia estado y retira de cola en el mismo commit.
8. Finalizar crea resultado y cambia job/índice en el mismo commit.
9. Una inconsistencia bloquea la activación; no se inventan datos ni se crea un almacén vacío como fallback.

La validación de apertura lee los metadatos requeridos sin recorrer todos los cuerpos de resultados. La migración, las pruebas de integridad y la lectura explícita de un resultado pueden materializarlos.

#### Límites

El índice escala con el número de jobs, no con el tamaño de sus respuestas. No se promete coste constante ni almacenamiento ilimitado. La fase no introduce paginación física del índice, archivo histórico ni purga. Retirar un documento Durable termina su encarnación activa; no asegura borrado físico de su historia ni reducción del archivo SQLite.

### Transiciones y recuperación

Se mantiene la máquina actual: `queued → provisioning → running → completed|failed`; `interrupted` conserva su significado público sin añadir una nueva política de clasificación en esta fase.

| Punto | Contrato |
| --- | --- |
| Admisión confirmada, respuesta no entregada | El replay encuentra el recibo y no crea otro job. |
| Job queued persistido | El reconciliador vuelve a seleccionarlo respetando concurrencia. |
| Conversación creada | Se reutiliza el ID de `provisioning`. |
| Submission admitida, ID aún no guardado en job | Repetir `submit` con `pi-agents:<job-id>` devuelve la misma submission. |
| Modelo/herramienta pendientes | Pi Durable aplica sus reglas públicas de recuperación/replay. |
| Submission terminal, resultado del job aún no confirmado | Releer el resultado durable y confirmar terminal una sola vez. |
| Job terminado, notificación pendiente | Reconstruir el conjunto desde el índice y notificar por la ruta existente. |
| Entrada Pi añadida, flag aún no confirmado | Comprobar el ID en la rama Pi activa, como en el comportamiento actual. |

Monitores, promesas y conteos en memoria no son autoridad. `provisioning` y `running` ocupan slots al reabrir. El cierre impide nuevas admisiones, espera el cierre del Harness y no convierte trabajos pendientes en fallidos por el mero cierre.

La notificación cruza dos almacenes y conserva el alcance de deduplicación por rama actual. No se promete entrega exactamente una vez ni se amplía esa garantía durante el rediseño.

### Actores, solicitudes y errores

#### Actor

`Actor` tiene `kind: human|model|extension|system` e `id` opcional. La procedencia se fija fuera del payload del modelo. Comando → humano; tool → modelo; reconciliación → sistema. `extension` se reserva como tipo, sin implementar RPC. La migración registra humano autorizante, pero no lo atribuye como creador de jobs antiguos.

No se confunde atribución local con autenticación criptográfica o autorización futura de revisión.

#### Inicio idempotente

- Tool: namespace `tool:` y `toolCallId` no vacío, dentro del SQLite de la sesión. No se deduplica por texto parecido.
- Comando: namespace `human:` y UUID nuevo por invocación; reintentos internos reutilizan ese ID.
- Intención canónica v1: versión, operación `start`, actor, nombre exacto del agente, tarea recortada en sus extremos y cwd absoluto normalizado conforme al contexto de entrada. Se preservan espacios internos y mayúsculas; no se aplica normalización semántica del lenguaje.
- Serialización JSON determinista por claves y UTF-8; hash SHA-256. El ID original se comprueba además de su clave hash.
- La consulta del ledger ocurre antes de resolver una nueva definición de agente/modelo. Las validaciones del contexto y su procedencia siguen siendo obligatorias; un replay no ejecuta de nuevo.
- Coincidencia de ID, operación, actor e intención: devolver el recibo de admisión original, con ID, agente y estado de admisión, no el estado mutable actual.
- Diferencia: `REQUEST_ID_CONFLICT`, sin mutación.
- Dos admisiones concurrentes con el mismo ID se vuelven a comparar dentro del commit; solo una crea el job.
- El snapshot resuelto vive en el job. Cambiar el archivo del agente después de la primera admisión no modifica el job ni el recibo.
- Errores previos a admisión no crean recibo de éxito ni reservan el ID indefinidamente.

El ledger no guarda cuerpos de resultados ni se purga automáticamente. La garantía dura mientras se conserve la base. El historial v1 no permite deduplicar retroactivamente tool calls cuyos IDs nunca se registraron.

Las transiciones internas y `markNotified` usan estado esperado e identidad de job; no necesitan un recibo nuevo por cada reconciliación. Migración genera un `requestId` administrativo al confirmar y conserva su recibo en `StorageMetaDoc`, no uno de inicio de job. Su deduplicación depende además de la versión global ya convertida.

#### Sobre de error

Los servicios usan el sobre común de [specs/README.md](../README.md#contratos-y-errores): `success: false`, `error.code`, `message`, `retryable` y `details` seguros. Los adaptadores conservan textos y campos existentes de la tool cuando corresponda, añadiendo el código programático sin reemplazar innecesariamente su formato público.

Códigos de esta fase: `JOB_NOT_FOUND`, `INVALID_REQUEST`, `AGENT_NOT_FOUND`, `UNSUPPORTED_TOOLS`, `MODEL_UNAVAILABLE`, `REQUEST_ID_CONFLICT`, `RUNTIME_CLOSING`, `MIGRATION_REQUIRED`, `MIGRATION_DECLINED`, `BACKUP_FAILED`, `STORAGE_VERSION_UNSUPPORTED`, `STORAGE_INCONSISTENT`, `STORAGE_BUSY` y `STORAGE_ERROR`.

`MIGRATION_REQUIRED` requiere intervención humana, no retry automático. Una versión futura o una inconsistencia no convierten jobs en `failed`. Errores de ejecución preservan el resultado técnico del job, distinto del error de una llamada de consulta. Diagnósticos sensibles se limitan a presentación humana; no se copian indiscriminadamente a detalles de tool.

### Apertura, propiedad y migración

#### Propiedad y detección

Cada acceso usa la ruta de sesión existente y un lock cooperativo por base, creado exclusivamente antes de abrirla. Runtime y mantenimiento comparten ese protocolo. El lock incluye token único y datos de propietario; solo el propietario elimina su lock al cerrar.

Un lock dudoso o residual bloquea con `STORAGE_BUSY`. Su recuperación es manual tras comprobar que el proceso terminó; no se borra automáticamente por antigüedad o por un PID posiblemente reutilizado. Las pruebas de caída abrupta deben incluir este paso operativo, no omitir silenciosamente el lock.

El lock no protege contra el código antiguo ni procesos que lo ignoran. Antes de migrar, el humano debe cerrar otros Pi que puedan acceder a esa sesión. El sistema no afirmará exclusión absoluta ni ofrecerá un flag `force` que la simule.

Se inspecciona el esquema antes de activar el scheduler. Una base nueva vacía se inicializa como esquema 2. Una v1 válida queda bloqueada por migración: se cierra el acceso de inspección y se libera su lock. Una base no vacía sin estructura reconocible o con versión futura se rechaza. `session_start` registra el bloqueo, pero deja disponible el comando de mantenimiento; este vuelve a adquirir propiedad y revalida el origen, sin confiar en la inspección anterior.

#### Entrada humana

`/subagents-storage migrate` actúa únicamente sobre la base de la sesión actual, sin parámetro de ruta arbitraria. Es independiente de los nombres de agentes. Informa de origen/destino, número de jobs, ubicación del backup y ausencia de downgrade directo; pide confirmación mediante UI humana.

Sin UI de confirmación o si se declina, no convierte ni reanuda trabajos. Las tools y modos headless solo reciben el diagnóstico. Una base actual responde «no requiere migración» sin volver a convertirla. Invocarlo sobre una sesión nueva no crea un backup ficticio.

#### Backup consistente

Antes de escribir la conversión se crea una copia mediante `node:sqlite.backup`, API pública disponible en Node inspeccionado. La conexión de backup se cierra antes de abrir el acceso de conversión. No se copia solo `.sqlite` ignorando WAL/SHM.

El destino se crea dentro de un directorio privado nuevo, único, junto al almacenamiento administrado; directorio `0700`, copia `0600`, sin sobrescribir backups existentes ni seguir un destino symlink. Se verifica integridad SQLite y lectura del estado v1 mediante APIs públicas, usando una copia de verificación si abrir el backend puede modificar metadatos. Se registra hash SHA-256 del backup cerrado, ruta y fecha. Un fallo conserva la fuente y bloquea migración.

El backup incluye conversaciones, submissions y estado del proveedor almacenado, no solo `JobsDoc`. Es sensible y queda fuera del repositorio. No se borra automáticamente tras migrar.

#### Conversión

1. Mantener el lock y el runtime detenido durante toda la operación.
2. Confirmar origen v1 y validar jobs, cola e identidades antes de convertir.
3. Obtener autorización humana y backup verificado.
4. Abrir `createSession(storage)`, sin Harness/scheduler ni proveedores de modelos.
5. En un commit: crear índice, familias por job y resultados; conservar IDs y valores; retirar `JobsDoc` v1 con `retireDoc`; escribir `StorageMetaDoc` con versión 2, `requestId` de migración, actor, fecha, origen/destino y referencia/hash de backup.
6. Verificar equivalencia de datos e invariantes antes de permitir activación.
7. Cerrar mantenimiento, transferir/liberar propiedad de forma serializada y abrir el runtime normal. Reanudar se rige por la semántica actual de apertura de sesión, no por una nueva orden de ejecución.

Los documentos nuevos y el retiro del origen se confirman juntos. La familia del ledger queda sin recibos históricos inventados. El callback `migrate(value, fromVersion)` de un token no se usa para efectos sobre otros documentos: la partición es una transacción de aplicación explícita.

#### Caídas y restauración

| Ventana | Resultado esperado |
| --- | --- |
| Antes o durante backup | Origen v1 utilizable; copia incompleta no aceptada como backup válido. |
| Backup listo, antes del commit | Origen v1; repetir exige nueva confirmación y backup verificado. |
| Durante conversión | SQLite conserva el commit completo o ninguno; no un índice parcialmente publicado. |
| Después del commit, antes de informar | Detectar esquema 2, validar y no repetir la conversión ni crear jobs nuevos. |
| Después del commit con validación fallida | Bloquear runtime, conservar evidencia y backup; no hacer rollback automático. |

La conversión materializa v1 y los destinos en una transacción: su coste crece con el tamaño del monolito. No hay migración por lotes en esta fase. El fallo por recursos no permite una conversión parcial presentada como éxito.

Restaurar exige cerrar todos los procesos, preservar la base fallida y sus sidecars, y restaurar el backup consistente en una ubicación sin WAL/SHM antiguos. Debe verificarse antes de abrirla. Restaurar descarta avances posteriores al backup y puede dejar efectos externos ya ejecutados: no revierte archivos o comandos. No hay restauración automática ni ejecución del código antiguo sobre la base convertida.

### Tipado y política de entorno

La matriz objetivo inicial es macOS arm64, Node `26.10.0`, Pi `1.0.4`, Pi Durable `1.0.1` y Chord `1.0.1`. Versiones superiores o distintas no se declaran verificadas por inferencia. El manifiesto y README dejarán de prometer Node `22.19` como mínimo operativo de esta implementación; el nuevo mínimo Node será `26.10.0`, sin equiparar ese rango a una matriz probada.

Los paquetes suministrados por Pi siguen como peers `*`, conforme a su contrato de paquetes; la política de soporte se documenta por separado. No se añaden a `dependencies` ni se empaquetan copias directas. Las dependencias transitivas de Durable se inventariarán explícitamente; no se ocultan ni se equiparan automáticamente al host.

Se añadirá `tsconfig.json` con modo estricto, `noEmit`, resolución ESM y soporte de imports `.ts`. El type-check incluye `index.ts` y todo `src/`, no una lista manual fija. No se sustituyen declaraciones ausentes por módulos `any` ni se silencian errores de integración con casts dobles. Durante la ejecución, el usuario autorizó `skipLibCheck: true` ante 44 errores en declaraciones distribuidas por dependencias. Se comprueba el código propio y su uso de tipos importados, pero no la consistencia interna de los `.d.ts`; esa limitación no acredita compatibilidad runtime y no elimina el gate de integración.

TypeScript y tipos de Node serán dependencias de desarrollo fijadas en lockfile. El plan seleccionará versiones concretas compatibles con Node objetivo; no se instala nada durante este diseño.

Un helper de desarrollo descubre el Pi instalado —con override explícito de ruta para instalaciones no estándar— y genera un tsconfig local ignorado con rutas a sus declaraciones públicas. Debe fallar con diagnóstico si falta el host, registrar versiones y resolver los subpaths usados. No se guardan rutas absolutas de la máquina en Git ni se modifican dependencias globales. La configuración generada no afecta a la resolución runtime.

`npm run check` ejecutará generación/validación del contexto de tipos, `tsc --noEmit` y comprobación de sintaxis. El smoke test en Pi comprobará la ruta real de carga; el test runner Node seguirá revelando su grafo local. Si la mezcla host `pi-ai 1.0.4` / local `1.0.1` es incompatible, se bloquea ese gate y se revisa la estrategia antes de alterar pins o usar APIs internas.

### Riesgos y restricciones residuales

- El rediseño completo amplía regresiones posibles: conservar caracterización pública y revisar transacciones, no solo la nueva estructura.
- Pi Durable es experimental; solo se usan exports públicos del pin inspeccionado.
- El índice, ledger y backups crecen; su retención futura requiere decisión explícita.
- La conversión atómica tiene consumo de memoria proporcional al monolito.
- El lock es cooperativo; versiones antiguas y herramientas externas pueden ignorarlo.
- La durabilidad SQLite declarada por upstream cubre caída de proceso; no se amplía a garantía absoluta ante corte eléctrico.
- Un backup no deshace efectos de herramientas ni las entradas ya escritas en la sesión Pi.
- El grafo local de dependencias y el host difieren; type-check y smoke deben comprobar la integración, no presuponerla.

### Entregables y relación con fase 01

Esta fase entregará código rediseñado, configuración de type-check, mantenimiento/migración, fixtures/harness, pruebas y documentación de comportamiento real. Su plan será independiente; este documento no fija tareas de implementación ni autoriza ejecutarlas.

La fase 01 consumirá servicios y almacenamiento del esquema 2. Añadirá consulta/listado/wait públicos, revisión y consumo con su propia versión/migración; el ledger existente soportará sus nuevas operaciones sin anillo de IDs que debilite la deduplicación. La ruta de una base histórica será v1 → fase 00 → migración de fase 01, manteniendo pruebas de extremo a extremo.

### Fuentes y comprobaciones de diseño

Inspección del 2026-10-06, no pruebas del sistema propuesto:

- Código del baseline: `src/jobs.ts` (archivo del baseline histórico, ausente en el árbol actual), [`index.ts`](../../index.ts), [`package.json`](../../package.json), [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
- Contratos públicos del paquete instalado `@earendil-works/pi-durable@1.0.1`: `defineDocFamily`, `createSession`, `Session.snapshot`, `Tx.doc`, `Tx.retireDoc`, commits y `Harness.resume`; README y declaraciones distribuidas. [Fuente upstream](https://github.com/earendil-works/pi/tree/main/packages/durable), cuya rama puede avanzar respecto al pin inspeccionado.
- Documentación de paquetes de Pi instalada con `1.0.4`: peers provistos por el host y riesgo de copias físicas. [Fuente upstream](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).
- API pública [`node:sqlite.backup`](https://nodejs.org/api/sqlite.html): export disponible en Node `26.10.0`; declaraciones locales inspeccionadas. Falta su prueba funcional específica, exigida por AC-10.
- `npm run check` y `npm test` del baseline: sintaxis correcta y 9/9 pruebas. No se ejecutó `tsc`, no se instalaron dependencias y no se migraron bases reales durante el diseño.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Pruebas y criterios de aceptación

| ID | Criterio verificable |
| --- | --- |
| AC-00 | Baseline identificado y cambios de implementación aislables/revisables; no se rehace el commit inicial. |
| AC-01 | `npm run check` detecta un error de tipos introducido de forma controlada y pasa con el código correcto; no basta `node --check`. |
| AC-02 | Las nueve pruebas actuales conservan sus comportamientos y pasan tras el rediseño. |
| AC-03 | Ningún adaptador Pi escribe documentos ni decide transiciones; revisión de imports y pruebas de servicios lo acreditan. |
| AC-04 | Una consulta de estado y una selección de cola con respuesta de 1 MiB no acceden al documento del cuerpo; una lectura explícita lo recupera íntegro. |
| AC-05 | Job, índice, cola y ledger no quedan parcialmente escritos ante fallo de commit. |
| AC-06 | Duplicados secuenciales, concurrentes y tras reapertura crean un job; distinto payload/actor/operación con el mismo ID falla. |
| AC-07 | Cambiar agente/modelo configurado después de admitir no altera el replay; repetir un comando humano como nueva invocación sí crea otro job. |
| AC-08 | Fixture v1 migra sin cambiar IDs, conversaciones, submissions, orden de cola, timestamps, resultados o notificaciones. |
| AC-09 | Detectar v1, rechazar confirmación o usar headless no inicia jobs ni convierte documentos. |
| AC-10 | Backup integra datos residentes en WAL; su restauración recupera jobs y conversaciones. Backup fallido impide conversión. |
| AC-11 | Versiones futuras, base no reconocida, datos incoherentes y lock ajeno se rechazan sin inicialización destructiva. |
| AC-12 | Cierre/reapertura y caída abrupta en queued, provisioning y running conservan la recuperación, sin duplicar conversación/submission. |
| AC-13 | Caídas en los límites de migración conservan v1 o esquema 2 completo; lock residual se trata explícitamente. |
| AC-14 | Una notificación pendiente se recupera; una ya registrada no se duplica dentro de la garantía de rama actual. |
| AC-15 | Los actores no pueden suplantarse desde argumentos de tool; jobs migrados no reciben autor inventado. |
| AC-16 | Smoke de carga real en Pi `1.0.4`, con inventario de resoluciones; validación manual de comando, tool, notificación y migración. |
| AC-17 | README, arquitectura y roadmap reflejan solo lo implementado y las limitaciones efectivamente verificadas. |

#### Fixtures y harness de pruebas

Las fixtures se generan reproduciblemente con las definiciones v1 del baseline y datos sintéticos, no con SQLite reales del usuario. Se conserva el generador/definición v1 congelado y su procedencia; no se regenera v1 con los tipos nuevos del migrador.

Deben cubrir cola, provisioning, running, completed, failed, interrupted sintético válido, múltiples resultados, notificaciones pendientes y respuesta de 1 MiB. Las activas incluyen conversaciones/submissions coherentes, no solo flags inventados. El generador nunca migra ni ejecuta herramientas externas reales.

Los helpers aportan directorio temporal, reloj/IDs inyectables, proveedor faux, barreras deterministas, reapertura y subprocess para caídas abruptas. Los tests no dependen de credenciales ni de sleeps como única prueba de una ventana de caída. La cobertura de `interrupted` heredado no afirma haber implementado una nueva ruta que produzca ese estado.

#### Evidencia de aceptación

Registrar comando, entorno, resultado, fixture, ventanas de caída probadas y commit. Distinguir pruebas automáticas, smoke de carga y prueba manual TUI. Una prueba unitaria verde no acredita autorización humana real ni resolución de módulos del host.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Referencia histórica de una fase completada según el roadmap; no es una nueva autorización de ejecución.
