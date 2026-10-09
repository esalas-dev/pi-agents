# Especificaciones evolutivas de `pi-agents`

## Estado y propósito

Este directorio describe una evolución **propuesta y aún no implementada** de la extensión durable local. Las especificaciones no describen funciones disponibles hoy ni autorizan por sí solas cambios de código.

## Roadmap operativo

El seguimiento global de fases, dependencias, bloqueos, gates y decisiones abiertas vive en [`ROADMAP.md`](ROADMAP.md). Este índice y las especificaciones definen el alcance normativo; el roadmap registra cuándo una fase está realmente lista para planificarse o completada.

La base existente permanece como punto de partida:

- un trabajo ejecuta un agente y una tarea;
- la ejecución ocurre en una conversación Pi Durable `ownerless`;
- `JobsDoc` y las conversaciones se almacenan en SQLite por sesión principal;
- `queued`, `provisioning` y `running` sobreviven al cierre y se reconcilian al reabrir;
- solo se admiten `read`, `write`, `edit` y `bash`;
- las notificaciones de finalización no se envían automáticamente al modelo principal;
- una autoridad distinta del ejecutor decide si acepta o promueve sus resultados.

## Secuencia obligatoria

Las fases deben diseñarse, implementarse y validarse en este orden, salvo excepciones humanas acotadas registradas aquí y en el roadmap. La [spec de fase 00](00-preparacion-arquitectonica.md), aprobada y aún no implementada, diseña la preparación de la base técnica antes de ejecutar las especificaciones funcionales. Su [plan de implementación](../docs/superpowers/plans/2026-10-06-fase-00-preparacion-arquitectonica.md) requiere revisión y elección del método de ejecución. Una fase no debe depender de contratos definidos únicamente en una fase posterior.

| Orden | Especificación | Resultado principal | Depende de |
|---:|---|---|---|
| 00 | [Preparación arquitectónica](00-preparacion-arquitectonica.md) | Rediseñar y tipar la base; migrar almacenamiento con autorización y verificar recuperación | Baseline `efc690f` |
| 01 | [Consulta, listado y espera](01-consulta-listado-espera.md) | Consultar trabajos y resultados con contratos comunes | 00 |
| 02 | [Control del ciclo de vida](02-control-ciclo-de-vida.md) | Cancelar, pausar, reanudar y reintentar | 01 |
| 03 | [Eventos y RPC](03-eventos-rpc.md) | Integración versionada con otras extensiones | 01–02 |
| 04 | [Resultados estructurados y gates](04-resultados-estructurados-gates.md) | Validar salidas y verificaciones deterministas | 01–03 |
| 05 | [Grupos y join](05-grupos-join.md) | Coordinar conjuntos sin sintetizarlos automáticamente | 01–04 |
| 06 | [Aislamiento con worktrees](06-aislamiento-worktrees.md) | Separar cambios y producir ramas candidatas | 01–05 |
| 07 | [Steering durable](07-steering-durable.md) | Redirigir trabajos activos con auditoría y recuperación | 01–06 |
| 08 | [Scheduling durable](08-scheduling-durable.md) | Crear ejecuciones programadas sin duplicarlas | 01–07 |
| 09 | [Workflows declarativos](09-workflows-declarativos.md) | Componer agentes, gates, joins y aprobaciones | 01–08 |
| 10 | [Interfaz operativa](10-interfaz-operativa.md) | Operar las capacidades anteriores desde una UI coherente | 01–09 |

**Excepción autorizada (2026-10-08):** se adelantan solo las etapas A y B del widget compacto de subagentes descrito en la [spec acotada](../docs/superpowers/specs/2026-10-08-widget-subagentes-design.md) y su [plan](../docs/superpowers/plans/2026-10-08-widget-subagentes.md), ambos aprobados humanamente; se eligió ejecución Native. El 2026-10-09 el usuario autorizó implementar B antes de aceptar A y aplazar la decisión de aceptación hasta revisar ambas conjuntamente. No adelanta el panel ni otras capacidades de fase 10; la secuencia de las fases 01–09 y sus dependencias se mantiene.

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

Las tools respetarán la política de exposición de la especificación 01: el agente padre recibe los resultados de sus subagentes verificados, mientras que callers no relacionados siguen sujetos al gate humano. Esa entrega no equivale a aprobación ni promoción. Las notificaciones generales seguirán fuera del contexto del modelo; la entrega al padre es una ruta específica y atribuida, no una autorización global.

### Compatibilidad y migraciones

`JobsDoc` tiene actualmente versión 1. La fase 00 propone convertirlo al esquema global 2 con documentos separados; aún no está implementado. La fase 01 ampliará ese esquema, sin duplicar la conversión estructural. Cada cambio de forma persistida debe incluir:

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
- **Revisión**: decisión humana registrada sobre el resultado; limita la exposición a callers no relacionados, pero no oculta el informe al padre verificado. No equivale a éxito técnico ni a promoción.
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
