<!--
Sync Impact Report
- Versión: plantilla sin versión → 1.0.0 (primera definición, no una ruptura de versión previa).
- Principios definidos (los títulos anteriores eran slots sin contenido normativo):
  - PRINCIPLE_1_NAME → I. Fuente de verdad durable.
  - PRINCIPLE_2_NAME → II. Idempotencia y recuperación explícita.
  - PRINCIPLE_3_NAME → III. Autoridad humana separada.
  - PRINCIPLE_4_NAME → IV. Seguridad y exposición mínima.
  - PRINCIPLE_5_NAME → V. Contratos públicos y simplicidad.
- Secciones concretadas: Restricciones técnicas; Flujo de desarrollo y gates; Governance.
- Secciones eliminadas: ninguna.
- Dependencias sincronizadas:
  - ✅ .specify/templates/plan-template.md: gates verificables por principio.
  - ✅ .specify/templates/spec-template.md: alcance, autoridad, recuperación y aceptación.
  - ✅ .specify/templates/tasks-template.md: pruebas y gates obligatorios según impacto.
  - ✅ .pi/prompts/speckit.tasks.md: generación de tareas alineada con esos gates.
  - ✅ .pi/prompts/speckit.implement.md: autorización y criterio de completitud.
  - ✅ README.md y AGENTS.md: referencia a esta constitución.
  - ✅ docs/ARCHITECTURE.md y demás prompts de .pi/prompts/: revisados, sin cambios necesarios.
  - .specify/templates/commands/ y docs/quickstart.md no existen; no se crean sustitutos.
- Seguimiento manual:
  - TODO(RATIFICATION_DATE): no consta adopción previa; registrar fecha ISO y aprobación humana.
  - ⚠ specs/README.md y specs/ROADMAP.md: conciliar pasajes que aún describen JobsDoc v1
    o fase 00 no implementada con los estados y esquemas posteriores. Deriva preexistente;
    esta actualización no cambia estados de fase ni certifica verificaciones históricas.
-->
# pi-durable-subagents Constitution

**Estado**: primera versión redactada; ratificación humana pendiente. Las aprobaciones de specs
anteriores no acreditan la adopción de esta constitución.

## Core Principles

DEBE/DEBEN equivalen a MUST; NO DEBE/NO DEBEN a MUST NOT. Son obligaciones verificables.

### I. Fuente de verdad durable

SQLite y los documentos Pi Durable DEBEN ser la fuente de verdad de trabajos, decisiones e historial.
Memoria, listeners, promesas, timers y UI DEBEN ser proyecciones reconstruibles; no pueden ser la
única evidencia de una decisión que cambie el comportamiento futuro. La intención DEBE persistirse
antes del efecto externo. Las transiciones y sus registros asociados DEBEN compartir commit Durable
cuando pertenecen al mismo almacén. Esto permite recuperar la semántica tras cerrar el proceso.

### II. Idempotencia y recuperación explícita

Toda mutación DEBE aceptar o generar un `requestId` y registrar operación, contenido canónico y
recibo durable. El mismo ID y contenido DEBEN devolver el recibo previo; contenido distinto DEBE
fallar con un código estable. La retención del ledger NO DEBE invalidar la deduplicación prometida.
Cada efecto externo DEBE identificar ventanas de caída y reconciliación. NO se promete `exactly once`
entre almacenes sin transacción común ni se repiten ciegamente efectos inseguros. La incertidumbre
DEBE producir un estado explícito, como `interrupted`, nunca éxito o cancelación supuestos.

### III. Autoridad humana separada

Un agente puede proponer, ejecutar o verificar, pero NO DEBE aprobar su propio resultado ni promover
automáticamente una rama o artefacto. Éxito técnico, revisión, consumo y promoción DEBEN conservar
significados distintos. Las decisiones humanas DEBEN registrar actor, instante y motivo; el origen
confiable determina la autoridad, no un campo declarado por el llamador. La aprobación o rechazo de
resultados DEBE proceder de la TUI humana activa; tools y RPC NO DEBEN atribuirse esa autoridad.
Una notificación NO DEBE incorporar resultados al contexto del modelo por defecto. La extensión
produce candidatos, no autorización de integración.

### IV. Seguridad y exposición mínima

Las instrucciones, respuestas, argumentos, diffs y bases de estado DEBEN tratarse como sensibles.
Agentes del proyecto solo se cargan con la confianza pública de Pi; confianza, conversación aislada,
cwd y worktree NO DEBEN presentarse como sandbox. Rutas y entradas externas DEBEN validarse antes
de producir efectos. Listados, eventos y notificaciones NO DEBEN incluir cuerpos completos por
defecto. Tools NO DEBEN revelar cuerpos pendientes o rechazados; las respuestas truncadas DEBEN
informar tamaño, hash e indicador de truncado. Logs, exportaciones y UI DEBEN aplicar límites y
redacción explícitos; la UI DEBE sanitizar controles de terminal. Estado sensible NO se publica ni
se incorpora al repositorio.

### V. Contratos públicos y simplicidad

Comandos, tools, RPC y UI DEBEN delegar las reglas y transiciones en los servicios de dominio comunes.
Los errores programáticos DEBEN conservar códigos estables separados del mensaje de presentación.
Solo se usan APIs públicas de Pi y Pi Durable: su ausencia DEBE bloquear la capacidad o producir
una degradación explícita, no acceso a campos privados ni durabilidad simulada. Cada cambio DEBE
resolver el alcance aprobado con los servicios y dependencias existentes; nuevas dependencias,
abstracciones o ampliaciones DEBEN justificar una necesidad actual y la alternativa más simple
rechazada. Esto evita contratos duplicados y capacidades aparentes que no sobreviven al reinicio.

## Restricciones técnicas

- El paquete usa TypeScript estricto y Node.js según `package.json`. El host objetivo y el entorno
  realmente probado se registran en `README.md`; NO se infiere compatibilidad con versiones no
  verificadas. Los peers del host NO se añaden como dependencias runtime directas.
- Pi Durable experimental DEBE permanecer fijado a una versión exacta. Actualizarlo requiere revisar
  contratos públicos, notas de versión y pruebas de recuperación.
- Una invocación ejecuta un agente y una tarea en conversación separada. Las herramientas admitidas
  son `read`, `write`, `edit` y `bash`; ampliar esa frontera requiere alcance y revisión explícitos.
- El almacenamiento es por sesión principal y cada archivo SQLite pertenece a un solo proceso.
  Apertura, cierre y liberación de recursos DEBEN respetar el lifecycle de sesión.
- Toda forma persistida DEBE tener versión. Cambiarla exige migración determinista desde versiones
  soportadas, fixture de la versión anterior y rechazo de versiones futuras desconocidas. Las
  conversiones estructurales requieren mantenimiento humano explícito, backup verificado y
  conversión atómica antes de abrir el Harness; si son irreversibles, se documenta la restauración.
- Campos nuevos DEBEN ser opcionales durante al menos una versión de lectura. Los estados públicos
  conservan su significado salvo cambio declarado y acompañado por migración.

## Flujo de desarrollo y gates

1. Antes de planificar, releer `specs/ROADMAP.md`, la spec de fase y esta constitución. Registrar
   dependencias, alcance, APIs públicas y bloqueos. La secuencia de fases solo cambia mediante una
   excepción humana acotada registrada en el roadmap y `specs/README.md`.
2. Antes de implementar, obtener aprobación humana de la spec vigente, revisión del plan detallado
   de esa fase y elección del método de ejecución. Una spec o esta constitución NO autorizan por sí
   solas implementar capacidades propuestas. No se sobrescriben cambios preexistentes ajenos.
3. Spec, plan y tareas DEBEN relacionar requisitos con autoridad, persistencia, exposición y pruebas.
   Un control no aplicable DEBE justificarse como tal. No se exige trabajo de fases posteriores.
4. Cambios de lógica no trivial o correcciones DEBEN incluir pruebas automatizadas del comportamiento.
   Contratos compartidos exigen pruebas de contrato/integración; mutaciones exigen duplicados y
   conflictos de `requestId`; nuevos estados no terminales exigen cierre/reapertura; efectos externos
   exigen pruebas de ventanas de caída; cambios de esquema exigen migración y versiones desconocidas.
   Cambios puramente documentales requieren validación de estructura, enlaces y coherencia.
5. Una entrega de código solo se marca completada con criterios de aceptación, `npm run check` y
   `npm test` verdes, revisión independiente y aceptación humana aplicable. Cambios de integración
   con Pi requieren smoke de carga; cambios TUI requieren aceptación interactiva, no solo mocks.
   Cada evidencia registra comando, resultado y versiones. Un fallo preexistente puede permitir
   continuar por autorización humana acotada, pero NO convierte la suite en verde ni cierra el gate.
6. README y arquitectura DEBEN describir solo comportamiento implementado, con límites observados.
   Specs, roadmap y planes distinguen propuesta, autorización, implementación y aceptación. No se
   cambian estados de fase sin evidencia verificable ni se presentan pruebas históricas como reruns.

## Governance

Esta constitución consolida las reglas transversales derivadas de `README.md`,
`docs/ARCHITECTURE.md`, `specs/README.md` y `specs/ROADMAP.md`. Tras ratificación, prevalece sobre
plantillas, prompts y planes contradictorios. Mientras esté pendiente, NO constituye una nueva
aprobación humana ni reemplaza las autorizaciones ya documentadas.

Toda enmienda DEBE registrar motivo, principios afectados, impacto sobre contratos y datos,
propagación documental y plan de migración si corresponde. Requiere aprobación humana explícita;
ningún agente puede certificarla por sí mismo. Las excepciones acotadas DEBEN registrar alcance,
actor, motivo y condición de cierre; no pueden eliminar silenciosamente límites de autoridad o datos.

La versión de esta constitución es independiente de la versión del paquete: MAJOR para eliminación
o redefinición incompatible de principios o gobernanza; MINOR para nuevas reglas o ampliaciones
materiales; PATCH para aclaraciones sin cambio normativo. La primera definición es `1.0.0`.
La fecha original de ratificación se conserva y cada cambio actualiza la fecha de enmienda.

Cada spec y plan DEBE evaluar el Constitution Check antes de investigar y después del diseño.
Cada revisión de cambios DEBE comprobar los cinco principios y sus gates, con evidencia o un
«no aplica» razonado. Conflictos bloqueantes DEBEN resolverse mediante cambio del artefacto o
procedimiento de enmienda, no diluyendo un principio. Las enmiendas sincronizan plantillas, prompts
y guía runtime e incluyen el Sync Impact Report con pendientes explícitos.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): registrar adopción humana en YYYY-MM-DD | **Last Amended**: 2026-10-09
