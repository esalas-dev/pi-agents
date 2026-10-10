# Comunicación durable entre el padre Pi y sus hijos directos

## Estado y autoridad

**Diseño conversacional y documento escrito aprobados por el usuario el 2026-10-08.** Este documento no autoriza implementación, migraciones reales, instalación ni promoción. El [plan de implementación](../plans/2026-10-08-comunicacion-padre-hijos.md) se presenta por separado y requiere aprobación humana; cualquier ejecución queda condicionada además al cierre independiente de T4 de fase 03.

Base inspeccionada: worktree `.worktrees/phase-03`, rama `feat/phase-03`, HEAD `95a424a`. Se conservan el plan, los informes y el ledger de T4. No se acepta T4 por este diseño ni se inicia T5.

Refina la enmienda de [especificación 01](../../../specs/001-consulta-listado-espera/spec.md), especialmente RF-04, RF-05 y RF-06. Mantiene el acceso restringido de [RPC de fase 03](../../../specs/003-eventos-rpc/spec.md). «Resultado completo» significa acceso a todo el texto mediante tramos acotados, no inyección ilimitada en una sola solicitud al modelo.

Evidencia: **[D]** documentación/tipos públicos; **[I]** inspección estática del código instalado o local; **[R]** decisión de diseño. No se ha ejecutado una prueba interactiva de entrega.

## 1. Objetivo y decisiones aprobadas

El padre puede encargar una tarea a un hijo directo y recibir su resultado sin una aprobación humana por lectura. La tarea inicial es la comunicación padre→hijo; la respuesta terminal es hijo→padre. No se introduce un chat bidireccional durante la ejecución.

Decisiones humanas del diseño conversacional:

- Reanudar automáticamente al padre inactivo; si está ocupado, encolar como `followUp`, sin interrumpirlo.
- Usar una outbox durable, con entrega al menos una vez y duplicados identificables.
- El padre es la sesión Pi completa, no la rama de conversación de origen.
- Leer también resultados `pending` y `rejected`, mostrando estado y motivo de revisión.
- Limitar cada entrega a 64 KiB y permitir al padre recuperar el resto por tramos.
- Separar entrega, notificación TUI, consumo, revisión y promoción.
- Migrar trabajos previos sin asignarles padre ni crear entregas retroactivas.

No incluye delegación anidada, comunicación entre hermanos, mensajes hacia hijos en ejecución, permisos nuevos de control, aprobación por tools, acceso entre sesiones, cambios al protocolo RPC ni nueva infraestructura externa.

## 2. Evidencia y límites de Pi

Fuentes locales consultadas bajo `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`, versión **1.1.0**:

| Fuente | Hallazgo |
|---|---|
| `docs/extensions.md`, apartados State y Context and session changes [D] | `sendMessage` incorpora contenido al contexto; `appendEntry` no. Cambiar de sesión invalida el contexto anterior. |
| `dist/core/extensions/types.d.ts`, `ExtensionAPI.sendMessage` [D] | Acepta `triggerTurn` y `deliverAs`; devuelve `void`, no un recibo de persistencia. |
| `dist/core/agent-session.d.ts`, `sendCustomMessage` [D] | Permite encolar durante ejecución o iniciar un turno cuando está inactivo. |
| `docs/message-types.md`, CustomMessage [D] | El contenido se convierte en mensaje de usuario para el proveedor; `details` no llega al modelo. |
| `docs/session-format.md`, CustomMessageEntry [D] | Los mensajes personalizados forman parte del historial; los CustomEntry no forman parte del contexto. |
| `dist/core/session-manager.d.ts`, ReadonlySessionManager [D] | Expone `getSessionId`, `getSessionFile` y `getEntries` para inspección del historial. |
| `dist/core/agent-session.js`, `_handleAgentEvent` [I] | En el flujo inspeccionado, se emite `message_end` a extensiones antes de persistir el mensaje. El evento no acredita guardado. |
| `dist/core/agent-session.js`, `sendCustomMessage` [I] | `nextTurn` usa una cola en memoria. No es almacenamiento durable ni el mecanismo elegido. |

[R] Usar únicamente las APIs públicas en la implementación. La inspección interna explica límites; no autoriza importar internals. Verificar el orden y la recuperación con el host instalado antes de aceptar la función; no extrapolar a cualquier versión futura.

[D/I] Las extensiones y trabajos comparten permisos del proceso/filesystem. La autorización descrita es una frontera de los adaptadores, no un aislamiento frente a extensiones maliciosas o procesos con acceso a SQLite e historial.

## 3. Vínculo de padre y autorización

[R] Al admitir desde `pi_agents`, el adaptador captura `parentSessionId` desde el contexto Pi confiable y lo persiste en el job, en la misma transacción que la admisión. El identificador de llamada permanece como actor de auditoría; no representa al padre, porque cambia en cada llamada.

- No exponer `parentSessionId`, modo de acceso privilegiado ni confirmación de entrega en argumentos de tools o RPC.
- No inferir parentesco de `createdBy.kind`, del cwd, de un `callerId`, de la tarea o del informe.
- Jobs de comandos humanos, RPC y jobs migrados carecen de vínculo: conservan su política actual.
- Una nueva llamada de `pi_agents` crea un nuevo hijo. El retry existente no copia implícitamente la autoridad de padre; queda fuera de la entrega automática de esta primera versión.
- Incluir el vínculo confiable en la identidad de una nueva admisión idempotente. Un replay no puede reasignar el padre ni añadirlo a un job antiguo. Conservar la interpretación de los recibos históricos.

La tool interna y el dispatcher aportan un contexto de lectura confiable, separado de los parámetros del modelo. El repositorio verifica que coincide con el vínculo almacenado y con la sesión del runtime. Sin vínculo verificable no se concede la excepción; no se abre el acceso a todos los jobs de la sesión.

La excepción permite **peek** independientemente de revisión. `consume` sigue siendo explícito, sujeto a sus comprobaciones actuales y a `requestId`; no recibe una excepción implícita por esta función. Ninguna lectura, tramo o entrega crea `job.consumed` ni modifica aprobación. La vista autorizada reúne estado, revisión vigente y resultado coherentemente; no vuelve a usar la lectura unrestricted como atajo.

## 4. Outbox privada de entrega

[R] Reutilizar Durable, sus transacciones y los patrones existentes. No usar el cursor ni el ACK de la outbox pública de eventos como confirmación de entrega al padre: son consumidores distintos. Los cuerpos no se publican por el bus RPC.

Modelo mínimo propuesto, no archivos implementados:

- `JobRecord.parentSessionId?`: vínculo opcional e inmutable.
- `ParentDeliveryDocFamily(jobId)`: `deliveryId`, `jobId`, `parentSessionId`, `createdAt`, `state: pending | delivered`, y `deliveredAt?`/`sessionEntryId?` como evidencia.
- Índice privado de entregas pendientes por job; al confirmar se elimina la referencia pendiente, no el recibo.
- `deliveryId` determinista con versión y hash de `(parentSessionId, jobId)`. Un nuevo job tiene otro ID; repetir la finalización no crea otra entrega.

No duplicar el texto del resultado en la outbox: guardar la referencia al resultado durable e inmutable. Cada envío obtiene una vista autorizada con revisión vigente. Un reintento puede mostrar una revisión posterior con el mismo `deliveryId`.

Toda transición terminal de un job vinculado crea la entrega pendiente en el **mismo commit** que el estado/resultado. Cubrir `finish`, fallos de provisioning/submit, `finishCancelled` y cancelación desde cola o pausa: `onSettled` por sí solo no cubre todas esas rutas.

Para `cancelled`, enviar solo estado terminal y `hasResult: false`; no exponer un cuerpo interno de cancelación ni relajar `RESULT_NOT_READY`. Para fallos sin texto, comunicar el estado sin errores internos, rutas o trazas. Esta entrega de estado tampoco constituye consumo.

## 5. Dispatcher y ciclo de vida

[R] Un dispatcher por runtime de sesión, con ejecución serial y un conjunto acotado de envíos en vuelo. Para la primera versión, un mensaje en vuelo basta. No añadir broker, worker externo ni temporizador por job.

1. Instalar la observación de pendientes y reconciliar su snapshot; suscribir y volver a leer para cerrar carreras de arranque/finalización.
2. Antes de enviar, verificar identidad de runtime/generación y sesión activa. Repetir la comprobación después de cada espera asíncrona relevante.
3. Reconciliar primero contra los mensajes ya incorporados a la sesión. Si existe evidencia coincidente, confirmar sin reenviar.
4. Obtener la vista autorizada actual y construir el mensaje acotado. Registrar en memoria el envío en vuelo **antes** de llamar a Pi.
5. Usar `pi.sendMessage(message, { triggerTurn: true, deliverAs: "followUp" })`. La sesión activa inactiva inicia un turno; la ocupada recibe el follow-up cuando termine su trabajo pendiente.
6. Observar incorporación y confirmar la entrega como se define en la sección 6. Despertar el siguiente pendiente fuera de callbacks que no permiten continuaciones.

Al cambiar/cerrar/recargar sesión, detener dispatcher, cancelar su temporizador, invalidar callbacks y liberar suscripciones antes de cerrar el runtime. Los callbacks antiguos no envían ni confirman en la sesión nueva. Al abrir la sesión original se reconcilia el historial y se recuperan pendientes.

Si un envío no tiene evidencia mientras Pi sigue ocupado, no reencolar por timeout: puede seguir legítimamente en la cola. Tras quedar inactivo, reconciliar y reintentar si no existe evidencia. Usar un único temporizador de comprobación con backoff entre 1 y 30 segundos para evitar bucles rápidos ante fallos; no hacer llamadas al modelo solo para sondear. Los errores de integración se diagnostican localmente sin volcar el informe.

Una interrupción humana no debe provocar un bucle que vuelva a despertar inmediatamente al modelo: tras un asentamiento abortado se conservan pendientes y se pausa el envío hasta una nueva interacción humana o reapertura. El contrato de recuperación presupone que la sesión vuelve a estar disponible; no garantiza entrega mientras Pi está cerrado, bloqueado o sin proveedor funcional.

## 6. Confirmación, duplicados y garantías

[R] `delivered` significa **incorporación observada en el historial de la sesión destino**, no lectura por el modelo, éxito de un turno, consumo ni aceptación del trabajo.

- El retorno `void` de `sendMessage` no cambia el estado durable.
- `message_end` solo solicita reconciliación posterior; nunca confirma directamente y no espera dentro del handler a que ocurra la persistencia que Pi hará después.
- La reconciliación consulta `ctx.sessionManager.getEntries()` mediante la API pública y busca un `custom_message` del tipo propio, con `deliveryId`, job y sesión coincidentes. Conserva `sessionEntryId` en el recibo.
- Los campos de correlación los construye el adaptador, fuera del texto del hijo. El contenido del informe nunca se interpreta como ACK.
- Escanear el historial una vez al abrir y reconciliar los pendientes; conservar solo IDs pertinentes en memoria. No cargar resultados de todos los jobs para deduplicar.

Se usa el historial de la **sesión completa**, no solo `getBranch()`, porque el usuario eligió padre por sesión. Una entrega incorporada a una rama abandonada no se reenvía automáticamente a cada rama alternativa. El padre puede volver a leerla con la tool. Un fork con otra identidad de sesión no hereda autoridad ni recibos válidos del original.

| Ventana de caída | Recuperación |
|---|---|
| Antes del commit terminal | No existe entrega parcial; recuperar ejecución con el mecanismo actual. |
| Después del commit y antes del envío | El pendiente durable se envía al reabrir. |
| Después de encolar, antes de incorporar | No hay ACK; reintentar al recuperar. |
| Después de incorporar, antes de confirmar en SQLite | Reconciliar historial y confirmar; si no se puede demostrar incorporación, tolerar reentrega con el mismo ID. |
| Después de confirmar | No reenviar normalmente; la tool conserva acceso al resultado. |

No hay transacción distribuida entre SQLite y el historial Pi ni promesa de `exactly once`. La API pública no ofrece recibo de `fsync`: incorporación observada no prueba supervivencia ante pérdida de energía o eliminación externa del historial. Las pruebas deben cubrir recuperación tras caída de proceso; no declarar una garantía mayor. Una sesión sin archivo persistente no permite confirmar entrega durable: conservar pendiente, diagnosticarlo y permitir lectura explícita sin iniciar un bucle de reenvío.

## 7. Formato y paginación UTF-8

[R] `customType: pi-agents-parent-result`, `display: true`. Tanto el mensaje automático como cada respuesta por tramos tienen **como máximo 65536 bytes UTF-8 de contenido textual total**, incluida cabecera, metadatos y delimitación. No son 64 KiB de cuerpo más cabecera.

El contenido visible al modelo incluye:

- Identificación de hijo, job y entrega; estado técnico y disponibilidad de resultado.
- Estado/motivo de revisión e instante de la vista. Es una fotografía, no autorización permanente; nuevas lecturas consultan la revisión vigente.
- Advertencia de que el informe es dato no confiable, no instrucciones humanas ni consentimiento para acciones protegidas.
- `totalBytes`, SHA-256 del texto completo, `offset`, `nextOffset` o `null`, e indicador `truncated`.
- Fragmento del texto en un campo serializado y escapado; no concatenar contenido del hijo en la cabecera de autoridad.

`details` replica solo metadatos de correlación/renderizado, nunca el cuerpo completo oculto. Como Pi proyecta CustomMessage a rol de usuario, atribución, rechazo y advertencia deben estar en `content`; `customType` o `details` no bastan como frontera de confianza. Delimitar texto no elimina el riesgo de prompt injection.

Extensión aditiva propuesta de la tool interna:

`pi_agents_result({ id, consume?, request_id?, offset? })`

- Sin `offset`, mantener compatibilidad de llamadas existentes; para el padre, devolver el primer tramo con los metadatos nuevos.
- Con `offset`, exigir padre verificado y operación `peek`; rechazar combinarlo con consumo antes de cualquier mutación. RPC no admite este parámetro.
- Offset es un entero seguro no negativo de **bytes UTF-8**, no caracteres ni unidades UTF-16. Validar rango y frontera de carácter; un offset inválido devuelve `INVALID_REQUEST`, sin cuerpo ni efectos.
- El servidor calcula el mayor fragmento que cabe tras serializar el sobre, sin partir caracteres. `nextOffset` avanza según bytes del texto original, no del JSON escapado.
- `offset === totalBytes` devuelve fragmento vacío y `nextOffset: null`; texto vacío también es válido. Un fragmento no final debe avanzar.
- Longitud y hash corresponden al texto completo e inmutable; cada tramo devuelve revisión vigente. No unir fragmentos de jobs/hash distintos.
- Reservar presupuesto para metadatos y truncar campos descriptivos desmesurados con indicador explícito, sin omitir identidad, estado de rechazo, hash ni cursor. Nunca exponer trazas internas como motivo público.

No añadir archivos temporales, rutas de SQLite ni una tool nueva. La paginación limita cada mensaje, no el costo total: leer todos los tramos también puede llenar el contexto. No recuperar automáticamente todos los tramos de un informe grande.

## 8. Migración y compatibilidad

[R] La base examinada usa esquema 4; fase 03 añade contratos de outbox propios. La implementación partirá del esquema efectivamente aceptado al cerrar T4 y asignará el siguiente número libre, sin reutilizar un número ni reescribir migraciones aceptadas. El plan debe fijar ese número tras inventariar la base final.

La nueva migración usa el flujo existente de mantenimiento, backup, autorización humana y exclusión del runtime. Inicializa la outbox privada vacía y deja los jobs previos sin vínculo, incluidos los que todavía estén activos; no deduce parentesco ni envía sus resultados retroactivamente.

Preservar resultados, revisiones, consumo, recibos, cola, `notified` y outbox pública. El runtime anterior debe rechazar el esquema nuevo. Jobs históricos permanecen accesibles bajo su política anterior; no se desbloquea el resultado protegido del fix T4 mediante este diseño.

## 9. Alcance técnico para el futuro plan

Rutas existentes inspeccionadas; los módulos adicionales son propuestas, no implementación presente:

| Área | Cambios previstos |
|---|---|
| `src/domain/jobs.ts`, `requests.ts` | Vínculo de padre, entrega y contexto interno de lectura; compatibilidad de admisión/replay. |
| `src/application/start.ts`, `result.ts`, `jobs.ts` | Propagar autoridad confiable y exponer lectura por tramos sin nuevos efectos de consumo. |
| `src/infrastructure/durable/documents.ts`, `repository.ts` | Outbox privada y escritura atómica en todas las transiciones terminales; confirmación idempotente. |
| Nuevo módulo de entrega privada bajo `src/infrastructure/durable/` | Consultar pendientes y recibos; no mezclar ACK público con entrega al modelo. |
| `src/runtime/session.ts`, `src/adapters/pi/register.ts` y dispatcher Pi pequeño | Lifecycle, observación/reconciliación, reanudación, mensajes y lectura del historial público. |
| `src/adapters/pi/display.ts` | Un formateador acotado compartido para mensaje inicial y tramos; revisión visible en contenido. |
| `src/infrastructure/storage/`, mantenimiento | Nueva migración y rechazo seguro de versiones; fixtures previas intactas. |
| Tests de admisión, repositorio, resultados, migración, runtime y adaptadores | Extender helpers/mock Pi y cubrir los criterios de la sección 10. |
| `specs/01-consulta-listado-espera.md`, `specs/README.md`, README de uso | Diferenciar contrato objetivo y runtime aceptado; documentar costo, límites y recuperación. |

No cambiar contratos públicos RPC, permisos de control, exportaciones innecesarias ni dependencias. Reusar el formato y las comprobaciones de límite existentes cuando sean adecuados; no construir un framework general de mensajería.

## 10. Criterios de aceptación y verificación

| ID | Evidencia requerida en implementación |
|---|---|
| PH-01 | Solo admisiones nuevas desde `pi_agents` tienen vínculo confiable; replay no reasigna autoridad. Comandos/RPC/migración/retry no lo heredan. |
| PH-02 | El padre lee `pending`, `approved`, `not_required` y `rejected`; rechazo y motivo son visibles. Otra sesión o caller declarativo no obtiene excepción. |
| PH-03 | Peek, entrega y paginación no cambian ledger, revisión, consumo ni producen `job.consumed`. Consumir conserva sus comprobaciones previas. |
| PH-04 | Todas las rutas terminales persisten estado y pendiente atómicamente; replay no crea otra entrega. Cancelled no filtra cuerpo ni permite consumo. |
| PH-05 | Padre inactivo inicia turno; ocupado recibe follow-up sin interrumpir tools; múltiples hijos se despachan sin duplicados por concurrencia local. |
| PH-06 | Caídas en las ventanas de la sección 6 recuperan pendientes. Fallo de envío no marca delivered. `message_end` previo al append no es ACK. |
| PH-07 | Incorporación sin ACK SQLite se reconcilia por historial. Duplicados conservan ID y no implican aceptación ni repetición automática de acciones protegidas. |
| PH-08 | Cambio de sesión/reload invalida callbacks; no hay envío cruzado. Rama alternativa sigue política de sesión; fork no hereda vínculo. |
| PH-09 | Unicode, comillas, barras, saltos, texto vacío y >64 KiB cumplen límite total; concatenar tramos recupera texto/hash sin pérdidas ni solapamientos. |
| PH-10 | Offset negativo, fraccional, inseguro, fuera de rango o dentro de carácter se rechaza sin efectos; offset con consume también. |
| PH-11 | Migración preserva datos y no genera entregas para jobs previos. La versión anterior rechaza el esquema nuevo. |
| PH-12 | Aborto humano no causa reanudación en bucle; sin historial persistente se informa el límite y se conserva recuperación explícita. |
| PH-13 | Regresión: gates RPC, revisiones humanas, cancelación, consumo/replay, notificación TUI y outbox pública mantienen sus contratos. |

Pruebas previstas: unitarias para autorización/formato; integración Durable con reapertura y fallos inyectados; adaptador con colas/historial Pi simulados respetando el orden real del host; y smoke test en Pi 1.1.0 con padre ocupado/inactivo, `/reload` y cambio de sesión. Un mock verde no sustituye la prueba del host.

Comandos existentes a usar durante implementación: `npm test` y `npm run check`, más pruebas focalizadas. No se ejecutaron para redactar este documento ni se afirma que validen esta función aún inexistente.

## 11. Entrega y siguiente autorización

Secuencia propuesta: aprobar este documento → redactar/revisar un plan separado sobre la base final de fase 03 → cerrar T4 antes de ejecutar este nuevo trabajo → implementación y revisión independiente con el método de subagentes acordado → aceptación humana.

Esta secuencia no modifica el estado de T4, no promueve cambios y no incorpora funciones de comunicación adicionales. El padre recibe datos, pero una autoridad humana independiente sigue aprobando las acciones protegidas.
