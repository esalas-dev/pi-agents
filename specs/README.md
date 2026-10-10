# Especificaciones evolutivas de `pi-agents`

## Estado y propósito

Este directorio usa la estructura de Spec Kit: `specs/<feature>/spec.md`, y `plan.md`/`tasks.md`
solo donde ya existía planificación. Incluye fases documentadas como completadas y propuestas
bloqueadas; una spec no implica disponibilidad en runtime ni autorización para implementarla.

La [constitución](../.specify/memory/constitution.md) consolida reglas transversales y mantiene
ratificación pendiente. El [informe de migración](MIGRATION.md) documenta fuentes, discrepancias
y casillas importadas; los [originales](_archive/pre-specify-2026-10-09/ARCHIVE.md) son históricos.

## Roadmap operativo

[ROADMAP.md](ROADMAP.md) conserva la secuencia, dependencias, gates, excepciones y evidencia.
README y arquitectura describen comportamiento implementado; las specs definen contratos de fase.
Esta migración no actualiza resultados de pruebas, estados de entrega ni aceptación humana.

## Secuencia obligatoria

Los identificadores 000–010 conservan los números de fase 00–10; 011 identifica el widget A+B,
**no una fase 11**. La excepción humana del 2026-10-08 adelanta solo el widget, no la interfaz
completa ni las capacidades de fases posteriores. La excepción humana posterior del 2026-10-09
permitió B antes de aceptar A y aceptación conjunta; ver [conciliación](RECONCILIATION.md).

| Fase/entrega | Spec canónica | Planificación existente | Estado documental |
| --- | --- | --- | --- |
| 00 | [Preparación arquitectónica](000-preparacion-arquitectonica/spec.md) | [plan](000-preparacion-arquitectonica/plan.md) · [tareas](000-preparacion-arquitectonica/tasks.md) | completada según el roadmap; aceptación documental contradictoria |
| 01 | [Consulta, listado y espera](001-consulta-listado-espera/spec.md) | [plan](001-consulta-listado-espera/plan.md) · [tareas](001-consulta-listado-espera/tasks.md) | completada según roadmap e informe de aceptación |
| 02 | [Control durable del ciclo de vida](002-control-ciclo-de-vida/spec.md) | [plan](002-control-ciclo-de-vida/plan.md) · [tareas](002-control-ciclo-de-vida/tasks.md) | completada según roadmap e informe de aceptación |
| 03 | [Eventos y RPC versionado](003-eventos-rpc/spec.md) | [plan](003-eventos-rpc/plan.md) · [tareas](003-eventos-rpc/tasks.md) | implementada en la base 94288cc; en validación; revisión independiente NO APTO, hallazgos por resolver; aceptación TUI recibida, alcance por precisar |
| 04 | [Resultados estructurados y gates](004-resultados-estructurados-gates/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; sin plan aprobado |
| 05 | [Grupos y join durable](005-grupos-join/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; sin plan aprobado |
| 06 | [Aislamiento durable con worktrees](006-aislamiento-worktrees/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; sin plan aprobado |
| 07 | [Steering durable y auditable](007-steering-durable/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; elegibilidad de paused pendiente |
| 08 | [Scheduling durable](008-scheduling-durable/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; parser y políticas pendientes |
| 09 | [Workflows declarativos y recuperables](009-workflows-declarativos/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; scheduler y decisiones de alcance pendientes |
| 10 | [Interfaz operativa y observabilidad humana](010-interfaz-operativa/spec.md) | Sin plan/tareas; bloqueada | propuesta bloqueada; la excepción widget A+B no habilita la fase completa |
| A+B | [Widget de subagentes A+B](011-widget-subagentes/spec.md) | [plan](011-widget-subagentes/plan.md) · [tareas](011-widget-subagentes/tasks.md) | A+B fusionadas; validación del candidato local faux aceptada humanamente el 2026-10-09; 328/328, check y revisión APTO. Correcciones sin publicar/integrar; fase 10 sigue bloqueada |

## Uso con Spec Kit

Spec Kit 0.11.9 resuelve la feature mediante `SPECIFY_FEATURE_DIRECTORY` o
`.specify/feature.json`, no por la rama Git. La migración no selecciona una feature por defecto,
no crea ramas y no regenera contratos aprobados. Para seleccionar **fase 03 para análisis**:

```sh
SPECIFY_FEATURE_DIRECTORY=specs/003-eventos-rpc \
  .specify/scripts/bash/check-prerequisites.sh --json --paths-only
```

El script persiste esa selección en `.specify/feature.json`; usar otra ruta de la tabla para
otra feature. Leer primero sus artefactos y el roadmap. `/speckit.analyze` es revisión, no ejecución;
`/speckit.implement` exige aprobación, plan revisado y método humano elegido. No reutilizar planes
históricos 000–003 como backlog nuevo. 003 ya tiene plan aprobado y método registrado;
se continúa con sus gates pendientes después de cerrar 011, sin reimplementar sus entregas.
En 004–010 no existen plan ni tasks: la ausencia mantiene el bloqueo, no se rellena automáticamente.

Los IDs T001… identifican **pasos** importados por feature. Los bloques T1… del texto original
conservan su significado mediante las tablas de trazabilidad. Las casillas de 001–002 no se
rellenaron a partir de la palabra «completada»; deben reconciliarse antes de reutilizar el registro.

### Integración Git instalada

En el worktree de conciliación se instaló la extensión oficial bundled `git` **1.0.0**
con Spec Kit **0.11.9**. El hook de `/speckit.specify` crea ramas para features nuevas;
no cambia la selección explícita de features existentes. Auto-commit desactivado,
selector local ignorado y solo prompts `speckit.*.md` permitidos en Git. Ver
[verificación y límites](../docs/SPECKIT-GIT-VERIFICATION.md).

## Principios transversales

### Fuente de verdad durable

SQLite y los documentos Pi Durable son la fuente de verdad. La memoria del proceso, widgets, listeners y promesas de espera son proyecciones reconstruibles. Toda decisión que cambie el comportamiento futuro debe persistirse antes de ejecutar su efecto externo.

### Idempotencia y ventanas de caída

Toda operación mutante debe aceptar o generar un `requestId`. Repetir el mismo `requestId` con el mismo contenido debe devolver el resultado previo; reutilizarlo con contenido diferente debe fallar. Cada especificación enumera las ventanas de caída y la forma de reconciliarlas.

No se debe prometer `exactly once` cuando intervienen SQLite y un sistema externo sin transacción común. Se documentará si una operación es:

- exactamente una vez dentro de un documento Durable;
- al menos una vez con deduplicación;
- como máximo una vez y recuperable como `interrupted`;
- o explícitamente reintentable por una autoridad.

### Autoridad humana separada

Un agente puede proponer, ejecutar o verificar. No puede aprobar su propio resultado ni promover automáticamente una rama, artefacto o cambio. Los estados de revisión y las acciones de promoción deben registrar actor, instante y motivo.

Las consultas desde tools respetarán la política de exposición definida en la especificación 01. Las notificaciones seguirán fuera del contexto del modelo salvo configuración explícita y auditable.

### Compatibilidad y migraciones

La evolución de esquemas 1 → 2 → 3 → 4 y el comportamiento implementado se documentan en `README.md` y `docs/ARCHITECTURE.md`. Las specs posteriores describen cambios propuestos, no el esquema actual. La migración documental no abre ni inspecciona bases reales. Cada cambio de forma persistida debe incluir:

1. nueva versión del documento;
2. migración determinista desde todas las versiones soportadas;
3. prueba con una base creada por la versión anterior;
4. rechazo claro de una versión futura desconocida;
5. copia de seguridad o procedimiento de rollback cuando la migración sea irreversible.

Los campos nuevos deben ser opcionales durante al menos una versión de lectura. Los estados públicos existentes conservarán su significado, salvo cambio declarado y acompañado por migración.

### Contratos y errores

Tools, comandos y RPC deben reutilizar servicios de dominio comunes. Ningún adaptador implementará transiciones de estado por su cuenta.

Los errores programáticos usarán un sobre estable:

```json
{
  "success": false,
  "error": {
    "code": "JOB_NOT_FOUND",
    "message": "No existe el trabajo solicitado",
    "retryable": false,
    "details": {}
  }
}
```

Los mensajes localizados son presentación; `code` es el contrato.

### Seguridad y datos sensibles

- Las instrucciones, respuestas, argumentos, salidas de gates y diffs pueden ser sensibles.
- Los eventos nunca incluirán resultados completos por defecto.
- Las rutas se resolverán y validarán antes de usarse.
- La confianza del proyecto es una barrera de carga, no una sandbox.
- El acceso a shell y worktrees conserva los permisos del proceso Pi.
- Los logs y exportaciones deben aplicar límites de tamaño y redacción explícita.

## Definiciones

- **Trabajo (`job`)**: unidad durable creada a partir de agente, tarea, modelo y cwd resueltos.
- **Intento (`attempt`)**: ejecución concreta; un retry crea un nuevo trabajo enlazado, no reescribe el historial.
- **Resultado**: respuesta final y metadatos terminales del trabajo.
- **Revisión**: decisión humana sobre exposición o aceptación; no equivale a éxito técnico.
- **Consumo**: registro de que un consumidor recuperó un resultado; no equivale a aprobación.
- **Gate**: verificación determinista ejecutada después de la respuesta del agente.
- **Promoción**: integración de una rama o artefacto fuera de esta extensión; nunca automática.
- **Actor**: `human`, `model`, `extension` o `system`, acompañado de un identificador cuando exista.

## Criterio global de terminado

Una fase solo se considera terminada cuando:

- todos sus criterios de aceptación pasan;
- `npm run check` y `npm test` están verdes;
- existen pruebas de recuperación cerrando y reabriendo el Harness en cada nuevo estado no terminal;
- se han probado duplicados de `requestId` y eventos;
- README y arquitectura reflejan solo el comportamiento implementado;
- no se introdujo una vía de aprobación o promoción automática;
- las limitaciones y APIs experimentales de Pi Durable quedaron registradas.

## Política de cambios

Si durante la implementación una API pública necesaria de Pi o Pi Durable no existe, se debe detener esa parte y documentar el bloqueo. No se accederá a campos privados ni se simulará durabilidad con estado exclusivamente en memoria para cumplir superficialmente la especificación.
