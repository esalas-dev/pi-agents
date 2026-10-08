# Aprobación de resultados por el agente padre

## Estado y autorización

Fecha: 2026-10-07. **Diseño conversacional y especificación escrita aprobados humanamente.** El usuario eligió «solo sus propios subagentes» y aprobó una herramienta explícita del padre, sin autoaprobación de hijos, sin revisión RPC y sin nuevos permisos de promoción. La aprobación escrita del documento en `9611a5c` habilita elaborar el plan, no implementación, instalación, migración real ni aprobación retroactiva.

Origen documental: `docs/parent-review-design`, worktree `.worktrees/parent-review`, sobre el bootstrap revisado `98a19223ce582e424ad534e1eebb008033ecc674`. La continuación autorizada se realiza en `.worktrees/parent-review-dev`, rama `feat/parent-review-dev`; el source instalado `.worktrees/parent-review` permanece en `efe1615`, sin modificaciones de producto.

**Enmienda de P3 — aprobada por revisión escrita en `e1fcfec`:** tras reproducir el bloqueo de cierre del SDK, el usuario eligió implementar la retirada en dos fases y conservar una observación para futuras versiones de Pi Durable. Esta enmienda sustituye únicamente el contrato de lifecycle indicado en §3.1 y precisa PR-09; no acepta el candidato P3 ni sus otros findings, no cambia permisos de review y no autoriza instalación/promoción. La revisión escrita fue aprobada con «listo, continua»; corresponde revisar el plan actualizado antes de implementar.

## 1. Objetivo y alternativas

Permitir que el agente principal de una sesión Pi autorice o rechace los resultados de los subagentes que él despachó, incluidos implementadores y revisores. Evitar una intervención humana entre cada resultado sin entregar esa autoridad al ejecutor ni a extensiones RPC.

Opciones consideradas:

1. **Herramienta explícita del padre — elegida.** Una decisión durable, auditada y acotada a sus hijos.
2. Aprobar al finalizar automáticamente — descartada: confunde disponibilidad con decisión y dificulta registrar rechazo.
3. Aprobar cualquier job de la sesión — descartada por la elección humana: incluiría trabajos ajenos, humanos o de extensiones.

No es un sistema nuevo de roles configurable, una cola adicional ni una autorización global de modelos.

### Distinciones obligatorias

- **Autorizar el resultado:** la decisión de `reviewStatus` permite o impide recuperarlo mediante las herramientas existentes.
- **Aceptar técnicamente el trabajo:** el padre juzga código, evidencias y revisión independiente; no deriva de `reviewStatus: approved` ni de `completed`.
- **Promover cambios:** merge, push, publicación y migraciones reales mantienen sus autorizaciones separadas.

El padre puede aprobar acceso antes de conocer el cuerpo del resultado y después mantener abierta la tarea por defectos. No se crea un nuevo estado de aceptación técnica en la base. El ejecutor propone/ejecuta; una autoridad distinta —el padre, para esta decisión delegada— evalúa. La autoridad humana conserva el control final.

## 2. Contexto examinado y límites de evidencia

Inspección de código, no prueba de comportamiento nuevo, en `98a1922`:

- `src/application/review.ts`: hoy solo admite actor `human`.
- `src/application/result.ts`: herramientas bloqueadas con review pendiente/rechazada, incluido peek; resultado disponible para completed/failed/interrupted.
- `src/adapters/pi/register.ts`: actor model identificado por toolCallId; sesión real desde `ctx.sessionManager.getSessionId()` y almacenamiento separado por sesión.
- `src/domain/jobs.ts`, `src/domain/requests.ts`: `createdBy` y ledger de operaciones; no vínculo padre-hijo persistente verificable.
- `src/infrastructure/durable/repository.ts`: decisiones y ledger en un commit; replay por requestId/hash. Bootstrap conserva el hash de reasons presentes y omite reason ausente.
- `src/infrastructure/durable/documents.ts`, `src/infrastructure/storage/inspect.ts`: documentos esquema 4 sin exigencia de shape cerrado para los campos aditivos propuestos.

La especificación de fase 03 aprobada en `e0d0a99`, `docs/superpowers/specs/2026-10-07-fase-03-eventos-rpc-design.md`, mantiene review RPC prohibido (§3.1/operaciones). Su frase «solo TUI humana» y la fila de eventos «Decisión humana» requieren precisión: TUI humana **o herramienta nativa del padre para sus hijos**, nunca RPC extension. Este documento propone esa modificación; no afirma que ya esté integrada ni modifica silenciosamente los artefactos aprobados.

No se probaron aquí SDK interactivo, TUI, ownership, nuevas herramientas, esquema 5 ni outbox. Los tests del bootstrap no prueban esta función. Entorno objetivo mantiene macOS arm64, Node 26.10.0, Pi 1.0.4 y Pi Durable 1.0.1; no se promete portabilidad universal.

## 3. Identidad, procedencia y alcance

### Padre

El padre es el agente principal atendido por el adaptador nativo de la sesión Pi actual. Su identidad durable es `parent:<sessionId Pi>`, derivada del contexto del host, no de un nombre de perfil, toolCallId, callerId RPC, argumento o variable suministrada por un hijo. Continuar/reabrir la misma sesión conserva esa identidad; una sesión nueva/fork distinto no hereda autoridad sobre sus jobs.

No se delega recursivamente: los workers Durable actuales reciben CodingTools y no reciben `pi_agents_review`, herramientas de aprobación ni un contexto nativo de padre. Este cambio no añade spawning de nietos.

### Vínculo persistente

Añadir `parentSessionId?: string` a JobRecord, exclusivamente desde la procedencia interna del adaptador nativo que admite un `pi_agents` del padre. Guardarlo junto con la admisión en el mismo commit; no se deduce de `createdBy.kind === model` ni del nombre del perfil. `createdBy` y el ID de tool call actuales se conservan.

La procedencia se entrega por un contexto interno del entrypoint, fuera de los params públicos; no se acepta un campo parentSessionId/actor/callerRole enviado por un modelo o por RPC. El servicio de admisión no puede conceder ownership solo porque un request declare actor model.

El ledger de nueva admisión conserva también el vínculo opcional para comprobar replay sin reasignaciones. No cambia el hash canónico histórico de start: ownership es evidencia interna adicional, no parámetro del intent. Un replay no crea ni reemplaza un vínculo y debe concordar con la evidencia interna vigente antes de exponer un job como propio. Un replay histórico sin vínculo sigue sin vínculo.

Human start y extension spawn no añaden ownership. Un retry nativo del padre solo añade el vínculo si el job fuente ya le pertenece y el contexto real lo acredita; nuevos jobs de retry humano/extension no reciben este permiso por copia indiscriminada de campos. `retryOf` no es una credencial. El vínculo no se modifica tras admitir el job.

### Comprobación

Una decisión parental exige conjuntamente: entrypoint nativo del padre, sesión/generación activa, vínculo persistente exacto con su sesión, job terminal con resultado recuperable y ausencia de decisión humana que retire o sustituya su permiso. La comparación del vínculo y la política se realiza dentro de la transacción que escribe la decisión; no basta un pre-read del servicio.

Las mismas comprobaciones preceden al replay de recibos: un ID viejo no evita la política actual. Una sesión invalidada no admite nuevas decisiones; su retirada sella y drena las escrituras ya admitidas antes de comenzar el cierre de storage. No se cambian jobs de la nueva sesión mediante callbacks de la anterior. Retirar la sesión de la interfaz no espera indefinidamente al modelo o a una UI; el cierre completo de sus recursos sí puede esperar al proveedor, según §3.1.

Este es un límite de autorización de entrypoints en un sistema local cooperativo, **no un sandbox frente a Bash con acceso de escritura a la base ni frente a plugins locales hostiles**. No se promete impedir alteraciones directas del filesystem mediante esta función.

### 3.1. Retirada segura en dos fases — enmienda P3

**Motivo y evidencia.** En Pi Durable 1.0.1, `Harness.close()` llama a `beforeClose()` → `TaskScheduler.join()`, antes de cerrar storage. El scheduler señala el cierre a las invocaciones, pero un proveedor que no atiende esa señal puede impedir que finalicen. El probe local `p3-sdk-close-probe.mjs/.log`, en el workspace SDD de este plan, observó cierre pendiente durante 1000 ms y lease retenido (`STORAGE_BUSY`); después de liberar el proveedor faux, el cierre terminó y el lease pudo adquirirse nuevamente. Es evidencia de un escenario aislado, no una garantía sobre todos los proveedores ni una prueba TUI. El límite de observación no es un timeout de producción ni permiso para liberar recursos.

**Fase 1 — retirar.** Añadir `SessionRuntime.retire(): Promise<void>` como operación interna idempotente. Invalidar autoridad/generación y sellar admisiones antes del primer await; detener bombeo y observadores; drenar todas las escrituras y notificaciones ya admitidas que puedan escribir, incluyendo `finish`, `markRunning`, review y `markNotified`. No esperar la resolución de nuevos inputs ni el resultado del modelo. Cuando ese drenaje termina, iniciar el cierre real del Harness y devolver la retirada. Repetir `retire()` espera la misma fase 1, no devuelve prematuramente por encontrar un flag cerrado.

**Fase 2 — cerrar recursos.** Conservar `SessionRuntime.close(): Promise<void>` como garantía de cierre completo: inicia/espera la retirada y después espera el cierre del Harness y la liberación del lease. Esto conserva el significado de `close()` para callers genéricos y pruebas existentes. La retirada inicia una única promesa de cierre en segundo plano, con rechazo observado; `close()` espera esa misma promesa. Liberar el lease solamente después del cierre real satisfactorio del storage. Si el cierre falla, registrar el fallo sin devolver éxito ni liberar el lease como si fuera seguro. Si el proveedor no termina, conservar recursos y lease; no hacer retry automático ni ocultar el fallo.

**Adaptador nativo.** Para cambiar de sesión, retirar el runtime anterior en vez de esperar su `close()` completo. Invalidar el estado anterior antes de await y verificar identidad/generación después de cada await de apertura; un runtime recién abierto pero obsoleto se retira sin publicarlo. Proteger callbacks tardíos también después de sus awaits. Una sesión con otra base puede abrirse tras la fase 1, aunque el proveedor anterior continúe pendiente.

**Misma base y reload.** No reabrir una base cuyo cierre real esté pendiente: el lease existente conserva la exclusión. El intento puede fallar con el código existente `STORAGE_BUSY` y una indicación de reintentar cuando termine el cierre; no se añade una cola de espera, polling ni temporizador automático. “Esperar” significa que la base no está disponible todavía, no que se bloquee toda la interfaz o el lifecycle de otras sesiones. Un fallo de apertura no envenena la cadena de lifecycle: debe permitir un intento posterior o cambiar a otra base. Un reload no garantiza que el proveedor anterior termine ni que esa base pueda abrirse inmediatamente.

**Límites.** No invocar `conversation.abort`, fabricar estados cancelled/interrupted ni registrar intención durable de cancelación al retirar. La señal de cierre interna del SDK no equivale a autorizar una cancelación de job. No saltar `Harness.close()`, alterar SDK/dependencias ni usar `Promise.race` para liberar recursos anticipadamente. La retirada no significa que el job haya terminado o que su resultado esté aprobado. No garantizar que una limpieza en segundo plano termine después de finalizar el proceso; un lease residual sigue las reglas existentes de recuperación humana, sin borrar locks automáticamente.

**Pruebas requeridas.** Promesas controladas con límite de test explícito: el modelo permanece bloqueado mientras `retire()` termina, `close()` sigue pendiente y la misma base devuelve `STORAGE_BUSY`; otra base abre y funciona. Al liberar el proveedor, `close()` termina y la base puede abrirse nuevamente. Probar también drenaje de un `finish`/`markNotified` ya iniciado antes de cerrar storage, ausencia de nuevas escrituras/notificaciones de callbacks tardíos, retiro idempotente concurrente, fallo observado de cierre con lease retenido, y cambio de sesión durante apertura sin publicación obsoleta. Conservar las pruebas mandatorias de herramienta, ownership y aislamiento de workers; no sustituirlas por mocks de fachada.

**Observación para futuras versiones de Pi Durable.** Al actualizar la dependencia, verificar nuevamente `Harness.close`, `Session.close` y el scheduler, usando el probe reproducible y tests de proveedor que ignora la señal. Buscar una API pública que separe el cierre seguro de storage del retorno de la invocación, sin writes tardíos, pérdida de lease ni cancelación durable implícita. No asumir que una versión nueva resolvió el límite por su changelog o por una suite verde. Solo simplificar las dos fases si esa garantía se demuestra con pruebas focales y revisión independiente; documentar versión examinada y resultados. Esta observación no autoriza actualizar ni parchear la dependencia ahora.

## 4. Herramienta y servicios

Nueva herramienta nativa `pi_agents_review`:

| Parámetro | Contrato |
|---|---|
| `id` | Job objetivo, string no vacío |
| `status` | `approved` o `rejected` |
| `request_id` | String no vacío para idempotencia; reusar el mismo para reintentar la misma decisión |
| `reason` | Opcional, string de hasta 2048 unidades UTF-16 (`string.length`, como control nativo); no se inventa un reason ausente |

No acepta actor, identidad del padre ni permiso de override humano. Los params son cerrados y malformados no producen escrituras. El adaptador construye actor `{kind: model, id: parent:<sessionId>}` y contexto nativo de autorización. No convierte al padre en human.

Reutilizar JobsService, ReviewService y repository.decideReview; separar el camino autorizado del padre del camino humano existente. No basta eliminar el guard `actor.kind !== human`: los callers genéricos model/extension/system sin contexto parental válido siguen rechazados. No duplicar el ledger ni sustituir la política de result.

Respuesta: recibo existente de revisión, con `decidedByActor` aditivo que identifica al autor real; mantener `decidedBy` para compatibilidad. Fallos usan códigos existentes: INVALID_REQUEST para identidad/scope/política/params inválidos, JOB_NOT_FOUND para job ausente, RESULT_NOT_READY para resultado no recuperable, REQUEST_ID_CONFLICT para intención distinta con mismo ID y STORAGE_ERROR para fallo de almacenamiento. No filtrar detalles internos ni inventar una política de autenticación RPC.

`pi_agents_result` conserva su contrato: aprobado permite peek/consume, rechazado lo bloquea; se verifica estado vigente incluso al reusar IDs de consumo. No se habilita lectura de un pending por un nuevo canal de bypass.

No aprobar automáticamente al completar y no alterar el resultado ni su status de ejecución. Mientras no exista la función, el job T1 pendiente `psa_1791395429528_ebfbb603bc69` conserva su gate actual.

## 5. Persistencia, decisiones humanas e idempotencia

Campos aditivos, sin tablas/documentos paralelos:

- JobRecord.parentSessionId y vínculo opcional en el record de admisión.
- JobReviewDocument.decidedByActor y ReviewReceipt.decidedByActor, opcionales para leer historia previa.
- RequestRecord.actor ya registra el autor completo; conservarlo sin suplantación.

JobReviewDoc, resumen de JobsIndex y ledger se actualizan en un único commit. Mismo ID/intención autorizada devuelve el recibo original sin otra decisión. Otro job/status/actor/reason con igual ID devuelve conflicto. Una transición a la misma decisión con ID nuevo puede registrar un recibo de no-op, pero no debe fingir otro cambio efectivo ni borrar autor/motivo/fecha de la decisión vigente. Un status distinto del padre sustituye su propia decisión anterior con ID nuevo; conserva los recibos anteriores.

Una decisión humana explícita toma precedencia: el padre no puede reemplazarla, ni siquiera con otro requestId, y un replay antiguo no restituye permiso retirado. El humano puede modificar una decisión parental por los comandos existentes. Reviews históricas approved/rejected sin decidedByActor se tratan conservadoramente como humanas, no como permisos delegados. No se introduce una herramienta para quitar el bloqueo humano.

Adiciones sobre esquema 4 sin elevar automáticamente la versión ni migrar datos reales. Los jobs existentes no se rellenan, no se adopta ownership por escanear nombres/perfiles o instrucciones del agente. Sin vínculo comprobable, continúa la aprobación TUI. No se recupera retrospectivamente la cadena de tool calls para inventar autoridad. Un nuevo admission válido genera el vínculo solo para nuevos jobs.

Leer registros y recibos históricos preservando campos opcionales ausentes y hashes previos. No reescribir recibos ni debilitar canonicalJson. Copias de backup conservan estos datos; la futura migración 4→5 de fase 03 debe preservarlos e incluirlos en su verificación de fuente, sin generar eventos históricos.

No se ofrece downgrade con escritura: una versión vieja podría omitir auditoría nueva o ignorar precedencia; volver a cargar código previo sobre una base ya escrita por esta función no se declara seguro. Recuperación mediante backup verificado y decisión humana, nunca automáticamente.

## 6. Compatibilidad con fase 03 y ejecución aislada

RPC review sigue siempre prohibido operacionalmente, callerId sigue declarativo y `rpcReview:false`. La aprobación parental no se publica como permiso de revisión RPC ni se concede por una allowlist.

Si fase 03 incorpora esta función, una decisión parental efectiva genera el mismo `job.reviewed` que la humana, en el commit de review/ledger/outbox; no se crea un nuevo evento ni se emite en replay/no-op. El payload público permanece en allowlist y no incluye parentSessionId, actores, motivo ni resultado. Especificación, plan, pruebas y referencia RPC deben aclarar que «decisión humana» no enumera todos los productores nativos, sin abrir la operación RPC.

La implementación se preparará sobre el bootstrap revisado, en rama/worktree propios, no como parche mezclado con T1. La instalación local del candidato requerirá autorización explícita y reload para probar el host; no cambiar .pi/settings mientras solo se revisa este documento. Después, la incorporación en feat/phase-03 necesita gate y verificación de integración, no aceptar T1 ni avanzar T2 automáticamente. Main y documentación humana pendiente se conservan.

Zonas focales previstas: dominio jobs/requests, documentos/repository, start/control retry para origen, review/result, runtime/session, register/display, tests y documentación de uso/autoridad. Esta lista es alcance técnico, no plan ni permiso de editar ya. Cualquier necesidad de schema nuevo, soporte recursivo o autenticación de terceros obliga a volver al diseño.

## 7. Aceptación requerida

| AC | Evidencia mínima |
|---|---|
| PR-01 | Native spawn persiste vínculo host/job/ledger atómicamente; human y extension no lo reciben; falsificación en params no lo crea |
| PR-02 | Padre aprueba/rechaza su hijo y ledger/recibo/review identifican model parent, nunca human |
| PR-03 | Sin vínculo, otra sesión/padre, worker, extension/system o contexto genérico model no puede aprobar; cero escrituras |
| PR-04 | Después de aprobar se recupera resultado; después de rechazar no; terminal fallido con resultado se puede revisar sin fingir éxito técnico |
| PR-05 | No hay aprobación al completar, no hay permisos de merge/migración ni lectura de pending por bypass |
| PR-06 | Replay autorizado no duplica decisión; cambio de intención da conflicto; retirada/decisión humana se respeta antes del replay |
| PR-07 | Humanos conservan comandos; legacy sin binding requiere TUI y no se reasigna; hashes/recibos antiguos permanecen intactos |
| PR-08 | Rollback de storage no deja review/index/ledger parciales; same-status no-op conserva autor/fecha/motivo y no repite evento |
| PR-09 | Retirada en dos fases: invalidación/sellado y drenaje de writes admitidos sin esperar al modelo; cierre real retiene lease, misma base bloqueada/otra base operable, cierre completo observable e idempotente; callbacks y aperturas obsoletos no actúan sobre otra sesión |
| PR-10 | Retry native propio captura ownership de forma autorizada; retry humano/extension o de origen ajeno no lo hereda |
| PR-11 | Host real: herramienta disponible al principal desde cwd ajeno, ausente de workers; aprobación padre→result sin comando humano; job ajeno bloqueado |
| PR-12 | Al integrar fase03: RPCreview bloqueado, proyecciones sin datos de identidad, reviewed atómico una vez por cambio y metadata conservada 4→5 |

TDD RED/GREEN real de policy/ownership/ledger/adapter y covering tests persistentes; tipos/sintaxis/suite completa y revisión independiente del rango exacto. Tests con fixtures no prueban por sí solos host/TUI ni ausencia de herramientas en una sesión real. Separar evidencia offline, host, integración fase03 y aceptación humana; documentar lo que no se verificó. No reutilizar evidencia anterior para aprobar el nuevo alcance.

## 8. Próximo gate

La especificación, §3.1/PR-09 y el plan actualizado fueron aprobados. P1/P2 aceptadas técnicamente; P3 corregida en `fc87a0b`. Por petición posterior del usuario, continuar P3/P4 sin subagentes y con autorrevisión final, cuya menor independencia se declara; no se modifica el requisito de revisión independiente antes de simplificar una futura versión SDK. Evidencia/gates actuales: `docs/PARENT-REVIEW-ACCEPTANCE.md`. Próximo gate externo: autorización de carga y validación real PR-11, después integración PR-12 separada. Nada de esto modifica autoridad instalada ni resuelve el gate pendiente del job legacy T1.
