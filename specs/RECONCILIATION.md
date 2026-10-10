# Conciliación de la migración con entregas fusionadas

## Registro vigente de integración de 003

La persona solicitó «integra y deja cerrado fase 03». Los fixes de `9c87c77` fueron
fusionados por PR #13 (`7f460a4`); `54e095a` integra además `4cffcdc`. Tras fetch se
comprobó que ambos commits de cambios son ancestros de `main` y `origin/main`.
**Fase 03 completada e integrada en `main` con límites**, sin repetir tareas históricas,
migrar bases reales, publicar un paquete ni habilitar 004–010. Ver [registro vigente](../docs/PHASE-03-ACCEPTANCE.md#integración-en-main--registro-vigente).

Este registro sustituye las restricciones anteriores de «sin integrar» para 003.
Las secciones siguientes conservan la cronología de la conciliación: sus afirmaciones de
checkout sin commits/merge y gates entonces pendientes no describen el estado vigente.
Las referencias locales `.cache/` históricas no son evidencia recuperada en este checkout.

## Base y autoridad

Continuación autorizada en `.worktrees/cierre-widget-011`, rama `011-cierre-widget`,
desde la ref local `origin/main`, commit `94288cc12151b25ba84c76b2854c1f21c8256355`.
No hubo fetch: no se afirma que sea la punta actual de GitHub. El checkout principal
`main` (`135856d`) conserva sus cambios de producto; no se trasladaron al worktree.

La importación inicial descrita en [MIGRATION.md](MIGRATION.md) procede de documentación
anterior. No constituye un backlog para reimplementar entregas ya fusionadas.
Esta conciliación no ratifica la constitución ni concede aprobaciones nuevas.

## Fuentes preservadas

- El archivo pre-specify y los hashes de [MIGRATION.json](MIGRATION.json) se conservan intactos.
- Se preservaron **24 snapshots** exactos de `94288cc` en
  [`_archive/origin-main-94288cc/`](_archive/origin-main-94288cc/SNAPSHOTS.json):
  18 documentos migrados y seis documentos de contexto/aceptación. SHA-256 y bytes
  comprobados antes de retirar las 18 rutas operativas antiguas; ningún contenido eliminado.
- No se dejaron dos backlogs activos. Los archivos históricos conservan sus enlaces y
  rutas originales; son evidencia, no instrucciones de ejecución.
- Diseños/planes de aprobación y comunicación padre-hijos siguen en sus rutas existentes;
  sus enlaces operativos a 001/003 apuntan a las features canónicas. La spec 001 advierte
  sobre esas enmiendas posteriores; su conciliación detallada no es parte del cierre 011.

## Estados conciliados

| Feature | Fuente posterior | Seguimiento vigente |
| --- | --- | --- |
| 011 | PR #12 fusiona A+B; [matriz del widget](../docs/WIDGET-ACCEPTANCE.md) registra visto bueno humano conjunto. El [plan posterior](_archive/origin-main-94288cc/docs/superpowers/plans/2026-10-08-widget-subagentes.md) registra excepción humana del 2026-10-09 para B antes de aceptar A. | Correcciones revalidadas; segunda revisión independiente APTO para solicitar aceptación humana. Guía TUI del candidato local faux aceptada humanamente el 2026-10-09; validación 011 cerrada, con límites conservados. Correcciones sin publicar/integrar; no se retira el visto bueno recibido. |
| 003 | [Plan posterior](_archive/origin-main-94288cc/docs/superpowers/plans/2026-10-07-fase-03-eventos-rpc.md) registra aprobación/método subagent-driven y entregas T1–T9. [Aceptación](../docs/PHASE-03-ACCEPTANCE.md) registra fase completada/promocionada administrativamente con límites. | Revisión independiente inicial NO APTO; N1–N5 corregidos y N6 revisada con fixture v4 válida para recuperación/replay. La persona aceptó el veredicto favorable posterior y ordenó la promoción; el informe independiente no es recuperable. Aceptación TUI humana explícita recibida, limitada al candidato faux local. Fixes integrados en `main` por `9c87c77`/PR #13 y `54e095a`; no publicar paquete ni reimplementar tareas históricas. |
| 004–010 | Propuestas bloqueadas y dependencias abiertas. | Sin nuevos planes, tareas ni implementación. El widget no promociona fase 10. |

Las 16 casillas de 011 se conciliaron con las **14 marcadas** en su fuente posterior:
son acciones históricas, no ejecución nueva de TDD ni cierre de todos los escenarios TUI.
T005/T015 se marcan ahora por aceptación humana de la guía local del candidato el
2026-10-09, no por alterar los snapshots; total vigente 16/16, con límites de evidencia.
Las 53 casillas importadas de 003 se conservan como
registro histórico; no se rellenan desde un resumen ni se usan como backlog vigente.

## Revalidación de 011 en este worktree

Se confirmó un incumplimiento de §5: la primera consulta fallida o lenta dejaba el widget
oculto. Se añadieron regresiones antes de modificar `subagents-widget.ts`; RED mostró
los dos fallos de montaje esperados. La corrección muestra «Estado no disponible» hasta
el primer snapshot exitoso, retira el aviso tras éxito vacío y no crea una advertencia
tras un snapshot vacío válido. No expone errores privados ni cambia dominio, storage,
RPC, dependencias o políticas. Se completaron los mocks TUI de tres suites de adaptadores.

| Comprobación | Resultado observado |
| --- | --- |
| Baseline tras copiar migración antigua | Check pasa; 320/321 tests. Único fallo: roadmap antiguo de 003, no baseline upstream puro. |
| Widget focalizado tras corrección | 23/23; ampliación final widget/runtime/lifecycle/índice: **63/63**, sin fallos. |
| Roadmap conciliado | Prueba de aceptación documental 1/1 pasa. |
| Primera suite tras corrección | Dos fallos por mocks TUI sin `setWidget`; no ocultados. |
| Suite tras completar mocks | **324/324**, sin fallos, cancelaciones, omisiones ni TODO. |
| `npm run check` | Exit 0; tipos y sintaxis, repetido tras conciliar documentación. |
| Selección explícita de 011 | Prerequisitos Spec Kit JSON: directorio 011 y tasks resueltos, sin mutar selector/rama. |
| Smoke CLI desde cwd ajeno | Exit 0, sin errores reportados; agente/estado temporales, offline, sin modelo/conversación. Salida `No models available`, no montaje visual. |
| `npm pack --dry-run --json` | 57 archivos; sin tooling/perfiles/caches/specs/node_modules, sin crear tarball ni publicar. |
| Documentación y preservación | 50 snapshots con hashes/bytes intactos; 32 documentos, 275 links locales existentes y fences cerrados; `git diff --check` y ausencia de stage comprobados. |

Logs locales ignorados: `.cache/pi-agents/verification/` (`widget-baseline-*`,
`widget-initial-read-red.log`, `widget-initial-read-green.log`,
`roadmap-reconciliation-green.log`, `widget-reconciled-tests.log`,
`widget-reconciled-tests-green.log`, `widget-reconciled-check.log`, `widget-final-*`,
`widget-smoke.stdout`, `widget-smoke.stderr`, `widget-pack-dry-run.json`). Son evidencia
local, no activos distribuidos. No se invocaron modelos ni proveedores en esos tests.

## Revisión independiente y correcciones

La persona responsable autorizó CLI independiente de solo lectura del modelo actual,
sin extensiones/MCP, escritura ni perfiles nuevos. Primera revisión
`openai-codex/gpt-6.1-sol`, high, exit 0: **NO APTO**. Identificó adquisición lenta
de B que bloqueaba A e IDs inequívocos truncados sin remisión al listado, además
de instrucciones documentales obsoletas. Informe preservado en
`.cache/pi-agents/verification/widget-independent-review.md`.

Se añadieron cuatro regresiones, RED **23/27** con los cuatro fallos esperados.
La corrección publica filas antes de observar; adquisiciones y cierres reservan
slots dentro del máximo cuatro, incluso ante fallo de cierre; cierre drena el
trabajo pendiente y descarta callbacks retirados. El render remite al listado si
ID+estado no caben y conserva tema/ancho. Dos expectativas antiguas de truncado
parcial se actualizaron al fallback correcto; un fallo intermedio reveló que el
resumen compacto debía usar el tema y se corrigió sin ocultarlo.

Revalidación de fixes: **67/67** focalizadas, **328/328** suite, sin fallos,
cancelaciones, omisiones ni TODO; `npm run check` exit 0. Logs
`widget-review-findings-*`. Segunda sesión CLI independiente, exit 0: **APTO para
solicitar aceptación humana**, sin findings nuevos. Informe preservado en
`widget-independent-rereview.md`; el revisor leyó código/callers/logs, no ejecutó tests.
No aprueba la entrega ni autoriza commits/promoción.

Smoke de fixes desde cwd ajeno: exit 0, offline, sin errores reportados, modelo,
conversación o TUI. Dry-run de fixes: 57 archivos, sin publicar. Se revalidaron
50 snapshots intactos y 32 documentos/276 links locales, fences y diff --check.
Logs `widget-fixes-smoke.*` y `widget-fixes-pack-dry-run.json`.

La persona declara haber observado **el widget A+B anterior**, solo el bloque
«Activos, cola y editor»: cwd ajeno, varios activos/cola, retiro al vaciar y
foco/escritura. No aporta ruta/versión exactas ni observación del candidato nuevo.
No se registra nueva evidencia de actividad/lifecycle, anchos/tema/animación ni
retry/compactación. Registro literal acotado en `widget-tui-user-observations.md`.
No se infiere aceptación completa desde esa declaración.

## Preparación TUI local — no cierra el gate

La persona eligió completar ejercicios restantes, no un cierre acotado, y autorizó
un perfil temporal faux. Lanzador/comprobador privados en
`.cache/pi-agents/verification/widget-tui*`; no se altera instalación, settings ni
perfiles personales. [Guía del candidato](../docs/WIDGET-ACCEPTANCE.md) describe
cwd/estado/sesiones temporales, dos tools locales, retry de job y limpieza normal.
Self-check con ModelRuntime/Harness/SQLite y smoke print faux verdes, sin proveedor
remoto. No es observación ni aceptación TUI, y el retry por servicio con actor de
prueba no acredita retry automático del proveedor. Fallos iniciales del comprobador
preservados y corregidos sin tocar producto; no se presentan como TDD de fixes.
Repetición posterior a preparar el fixture: **328/328** suite y `npm run check`
verdes (`widget-tui-preparation-{tests,check}.log`), sin omisiones/cancelaciones/TODO.
Sintaxis de mjs/bash comprobada; 50 snapshots intactos, 2 documentos/10 enlaces
locales y fences válidos, diff --check limpio y sin stage. Smoke: stderr vacío y
su directorio temporal eliminado. No hubo nueva aceptación ni revisión del producto.

## Aceptación humana de 011 — 2026-10-09

Tras recibir el lanzador/guía del candidato, la persona confirmó literalmente:
«listo, todos los escenerios pasaron correctamente». Se registra aceptación de los
bloques guiados 1–6, no observación visual del asistente ni prueba de proveedor remoto.
Registro local `widget-tui-acceptance.md`; identificación del candidato por la guía
(ruta/hash/host suministrados), sin captura ni medición independiente enviada por la
persona. Ver [alcance y límites](../docs/WIDGET-ACCEPTANCE.md).

Con suite/check verdes y revisión APTO previa, se cierra la validación de 011 y
T005/T015. No se publican/integran las correcciones ni se promueve fase 10. La
revisión CLI de solo lectura de 003, ya autorizada después de aceptar 011, puede
iniciarse; 003 conserva sus gates propios pendientes.

## Seguimiento de 003 — 2026-10-09

La CLI autorizada de lectura finalizó exit 0, stderr vacío; informe ignorado
`phase03-independent-review.md`: **NO APTO**, N1–N5 obligatorios reportados y N6
recomendado. Se revalidaron los callers y transiciones y se corrigieron N1–N5 con
regresiones focales: `335/335` y `npm run check` verdes; no se ejecutó migración real.
N6 se revisó después con una fixture v4 válida: migración, replay idempotente del ledger
canónico y recuperación de un `running` con IDs Durable reales pasan; evidencia local en
`phase03-n6-review.md`.
La persona declaró literalmente «acepto la TUI de 003» y precisó que observó todos los bloques
de la guía directamente en una TUI visible e interactiva, sobre el candidato faux local temporal
de este worktree. No se probaron proveedores remotos ni migraciones reales; no es observación del
asistente ni aprobación de futuros fixes. Ver [matriz](../docs/PHASE-03-ACCEPTANCE.md).

Las validaciones de 003 y la fase quedan cerradas/promocionadas administrativamente con
límites: la persona aceptó el veredicto favorable posterior a N1–N6 y ordenó completar la fase,
pero el informe no se obtuvo por fallo de almacenamiento del reviewer. N6 queda cubierta por
la fixture local documentada en `phase03-n6-review.md` y la decisión humana en
`phase03-independent-rereview-human-approval.md`; el cierre consta en
`phase03-validation-closure.md` y la promoción en `phase03-promotion.md`. El alcance TUI ya
quedó registrado con sus límites. No se alteran las 53 casillas históricas ni se habilitan fases
004–010 automáticamente, publicación o migración real.

## Gates que no se sustituyen por tests

- Revisión independiente inicial NO APTO; fixes implementados y nueva revisión
  **APTO para solicitar aceptación humana**, con autorización específica. El perfil existente
  restringido a otra rama/worktree no se reutilizó; las revisiones no crearon perfiles.
  Solo el fixture TUI posterior usa un perfil desechable autorizado separadamente.
- Además de la declaración sobre versión previa, se recibió aceptación humana de
  los bloques guiados del candidato local faux: tools/lifecycle, anchos/tema y movimiento
  reducido sin fallos declarados. No se promete Pi 1.0.4 ni observación de compactación,
  retry automático/deferred o fallos no inducidos; fixtures no sustituyen a esa declaración.
- Validación de 011 cerrada con su alcance documentado. Las validaciones y la fase 03 quedan
  cerradas/promocionadas administrativamente: revisión independiente inicial NO APTO, N1–N5
  corregidos localmente, N6 cubierta por una fixture v4 válida de recuperación/replay y el
  veredicto favorable posterior aceptado humanamente, pero sin informe independiente recuperable.
  La aceptación TUI propia queda limitada al candidato faux local temporal sin proveedor remoto
  ni migración real. No hereda evidencia del widget ni se presenta como evidencia independiente.
- Durante aquella validación, sin stage, commits, push, merge, migraciones de bases reales ni cambios de settings
  privados/instalación del paquete Pi. La extensión Git de Spec Kit sí se instaló
  por decisión separada; [verificación](../docs/SPECKIT-GIT-VERIFICATION.md).
