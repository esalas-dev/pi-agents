# Aprobación parental — aceptación offline

## Alcance y estado — registro histórico previo a integración

Implementación en `feat/parent-review-dev`, worktree `.worktrees/parent-review-dev`. P1/P2 cuentan con revisiones históricas independientes; P3 corregida en `fc87a0b` y deuda de formato #64 cerrada separadamente en `966f549`. P3/P4 y revisión final son **autorrevisión**, no revisión independiente, por instrucción expresa de continuar sin subagentes.

Esta aceptación cubre software y pruebas **offline**. No acepta instalación, funcionamiento en Pi TUI real, promoción, merge, publicación ni integración fase03. El paquete instalado permanece en `.worktrees/parent-review` (`efe1615`), sin la herramienta parental de P3. Settings/compaction/perfiles y bases reales no se modificaron.

Entorno objetivo: macOS arm64, Node26.10.0, Pi1.0.4, Pi Durable/Chord1.0.1. No se promete portabilidad universal ni aislamiento frente a plugins/filesystem hostiles. La autoridad nativa es de runtime, no credencial JSON.

## Criterios de la spec

| Criterio | Resultado offline | Evidencia persistente |
|---|---|---|
| PR-01 vínculo host/job/ledger, sin falsificación | Verificado | parent-admission; parent-native-runtime |
| PR-02 revisión propia auditada como model | Verificado | parent-review; parent-native-runtime; parent-approval-acceptance |
| PR-03 genérico/ajeno/legacy no concede permiso, sin writes | Verificado | parent-admission; parent-review; snapshots SQLite de native inválidos |
| PR-04 acceso tras approve, rechazo y reporte failed sin fingir éxito | Verificado | review-consume; aceptación integrada |
| PR-05 no autoapprove/aceptación técnica/bypass pending | Verificado | aceptación integrada; tool cerrada y worker SDK real |
| PR-06 replay/conflicto respeta permiso vigente/humano | Verificado | parent-review; review-consume; aceptación integrada |
| PR-07 humano, legacy sin adopción, hashes históricos | Verificado | parent-admission; parent-review; native y aceptación integrada |
| PR-08 rollback/no-op conserva coherencia/auditoría | Verificado | parent-review, snapshots de review/index/ledger |
| PR-09 dos fases, writes/observadores, lease y lifecycle | Verificado | session-runtime; coordinator; pi-adapters; parent-native-runtime |
| PR-10 retry nativo con toolCallId distinto y sin herencia genérica | Verificado | parent-admission; retry; parent-native-runtime |
| PR-11 Pi real desde cwd ajeno, carga y flujo interactivo | **NOT VERIFIED** | Requiere autorización de carga y sesión real; fixtures no sustituyen host |
| PR-12 RPC/outbox/proyección/migración4→5 | **VERIFICADO OFFLINE en PR #10** | job-events; rpc-authority; migration-v4; lifecycle; ver integración al final |

Los nombres de evidencia corresponden a `tests/<nombre>.test.mjs`. El flujo integrado usa SQLite/Harness/servicios reales y proveedor faux: spawn→pending bloqueado→approve model→peek/consume→reopen conserva identidad→human.reject→parent/replayconsume denegados; otro padre y job sin vínculo requieren humano. La segunda rama autoriza leer diagnóstico de ejecución failed sin cambiar su status. Se inspecciona `conversation.agent()` real: read/bash, sin review ni delegación.

## Retirada y observación SDK futura

Contrato aprobado: [§3.1 de la spec](superpowers/specs/2026-10-07-aprobacion-padre-design.md). `retire()` sella/invalida síncrono, detiene observación y drena writes admitidos antes de iniciar cierre SDK; comparte fase 1 sin esperar proveedor. `close()` comparte fase completa y libera lease solo tras cierre SDK satisfactorio. Rechazo SDK se observa/propaga y conserva lease; fallo fase 1 no inicia fase 2.

Otra base puede operar mientras el proveedor anterior sigue pendiente; la misma base/reload devuelve `STORAGE_BUSY`, con reintento manual tras cierre real. Fallos de apertura no envenenan lifecycle. No hay aborto durable implícito, timeout para liberar lease, lock removal automático, nuevo manager/cola ni garantía de cleanup después de process exit. Puede haber retención indefinida de recursos.

**Reevaluar futuras versiones de Pi Durable:** versión examinada1.0.1; `Harness.close()`/Session beforeClose/scheduler.join pueden esperar un proveedor que ignore señal. Probe local `p3-sdk-close-probe.mjs/.log`: pendiente a1000ms y lease ocupado hasta liberar proveedor, sin tocar bases reales. Es diagnóstico, no sustituto del test de retire. Chord `withCancel` cancela únicamente el waiter; extracción usa `Conversation.entries` read-only de rango exacto.

Antes de simplificar en otra versión: inspeccionar APIs públicas y repetir proveedor ignorando señal, writes tardíos, ambas fases concurrentes, cierre fallido, lease/reapertura y ausencia de cancelación durable; exigir revisión independiente. No se actualizó/parcheó SDK ni dependencia.

## Evidencia y límites de revisión

Evidencia local conservada en `.superpowers/sdd/2026-10-07-aprobacion-padre/`: logs RED/GREEN/check/suite, briefs, paquetes de rangos exactos y progress. No se incluyen SQLite/credenciales en el paquete.

El RED original P3 tenía aserción/index incorrectos y no demuestra un fallo funcional; su reporte se corrigió por append sin borrar historia. Fix P3 sí dispone de RED conductuales/API diferenciados, incluida observación read-only, clone de proxy SDK, retry/wait y apertura fallida. P4 acceptance pasó desde el primer intento: cobertura de comportamiento ya corregido, **no RED artificial**.

Verificación de cierre: `node --test --test-timeout=10000 tests/parent-approval-acceptance.test.mjs`, `npm run check`, `npm test`, `npm pack --dry-run`, `git diff --check`. Resultados: aceptación2/2, suite165/165, check de tipos/sintaxis0, pack dry-run0 (42 archivos, sin workspace/SQLite), diff-check0. Check emite solamente el aviso experimental Node sobre stripTypeScriptTypes, no un error. Rango de autorrevisión final y límites en ledger/report de cierre. Un dry-run prueba inclusión de archivos, no instalación ni TUI.

No se probó proveedor remoto, filesystem hostil, crash físico ni versión SDK distinta. Notificaciones Pi/SQLite no son atómicas: una caída antes de markNotified puede duplicar aviso. Acceso autorizado a un informe, tests verdes y aceptación humana de implementación siguen siendo decisiones distintas.

## Gates externos conservados

1. Autorizar carga del candidato revisado; backup y cambio único de referencia de paquete, sin doble carga. El humano decide si antes exige reviewer independiente.
2. PR-11: sesión Pi real desde cwd ajeno, herramienta presente solo en principal, aprobación propia y acceso sin comando humano, human reject efectivo, ajenos/legacy bloqueados; switch/reload/busy/otra base/reapertura. Registrar evidencia y aceptación aparte.
3. PR-12: autorización e integración fase03, outbox reviewed atómico por cambio efectivo, no evento replay/no-op, RPCreview bloqueado, proyección privada y metadata/migración conservadas.

El job histórico T1 sin vínculo mantiene gate humano. No se le adoptó ownership ni se leyó su reporte alrededor del gate. Este registro original no concedía permiso implícito para instalar, migrar datos reales, merge/push/publicar.

## Integración PR #10 — 2026-10-09

El humano autorizó incorporar ambas implementaciones a main; PR #11 ya quedó integrado en la rama parental. La resolución combina `origin/main` mediante merge, sin rebase ni force-push, y condiciona publicación/fusión a gates técnicos verdes. Es autorrevisión inline solicitada, no revisión independiente ni aceptación global de fase03.

La cobertura integrada conserva autoridad parental ligada a generación, precedencia humana, replay/no-op, privacidad y atomicidad review/index/ledger/outbox, rechazo RPCreview y esquema 5. Una toma humana con igual status genera `job.reviewed`; repetir el mismo autor/status no lo duplica. Migración 4→5 conserva binding, autor y ledger, los incluye en hash de consentimiento y no crea eventos históricos ni adopta jobs legacy.

Lifecycle limpia RPC/emisor antes de retirar el runtime y no espera al proveedor para cambiar a otra base. Retirada sella nuevas operaciones; las pruebas de writes admitidos bloquean una transacción ya iniciada, no una llamada nueva después del sello. `close()` sigue esperando SDK y conserva lease ante fallo; el reporte operativo tardío no reactiva autoridad. Se mantienen dos pruebas que antes habían quedado combinadas en un solo bloque durante el merge.

La resolución usa el host detectado Pi 1.1.0 sin cambiar dependencias ni instalar paquetes. El gate antiguo fijado a Pi 1.0.4 desaparece por integrar el descubrimiento ya existente en main, no por omitir la prueba. Logs RED/GREEN y suite están conservados localmente en `.superpowers/pr-parent-review-integration/`; son evidencia del autor.

Verificación integrada: `npm test` 289/289, sin fallos/cancelaciones/skips; `npm run check` tipos/sintaxis exit 0; `npm pack --dry-run` exit 0, 59 archivos sin estado/evidencia/SQLite; `git diff --check` exit 0. La comprobación del estado/diff del checkout principal coincide con el snapshot inicial. Mem-stack bloqueado: CLI no disponible (exit 127), sin instalación ni edición de memoria.

PR-11/TUI real y AC-03-17 siguen pendientes. No se ejecutó modelo remoto, instalación/reload, migración real, aceptación TUI ni revisión independiente. Las referencias de instalación y resultados 165/165 anteriores son históricos, no verificación de la instalación actual.
