# Migración de documentación a Specify / Spec Kit

Fecha: **2026-10-09**. Estructura y scripts locales: **Spec Kit 0.11.9**, integración Pi.

## Alcance y autoridad

La persona responsable autorizó migrar **todas las fases 00–10 y el widget A+B**, realizar
adaptación completa y **archivar los originales**. Se excluyeron los históricos de `.superpowers/`.

Esta autorización permite reorganizar documentación y referencias. **No autoriza implementar
fases, cambiar ramas, crear commits, migrar bases SQLite ni aprobar entregas**. La
[constitución 1.0.0](../.specify/memory/constitution.md) no se modifica: sigue pendiente ratificarla.

Había cambios previos en documentación, código y pruebas. Las fuentes archivadas incluyen el
contenido del working tree existente, no una recuperación desde HEAD. No se sobreescribió código,
pruebas, configuración Pi ni las modificaciones ajenas; no se restauraron archivos desde Git.

## Análisis y precedencia

1. **README y arquitectura** documentan capacidades implementadas; no implican ejecución nueva.
2. **Roadmap** conserva estados, dependencias, método elegido y decisiones humanas registradas.
3. **Specs canónicas** preservan contrato, alcance, IDs RF/AC, límites y criterios de aceptación.
4. **Planes/tareas** conservan pasos y comandos existentes, no los convierten en ejecución vigente.
5. **Aceptación** conserva evidencia histórica, versiones y limitaciones; no se reejecutó ni certificó.
6. **Archivo** conserva originales byte a byte, no constituye otra fuente operativa ni otro backlog.

La fase 03 requiere precedencia específica: el diseño aprobado del **2026-10-07** sustituye los
puntos incompatibles de la propuesta anterior. La nueva spec contiene el diseño aprobado completo:
outbox transaccional obligatorio, ledger sin TTL, `correlationId` por intento, `review` RPC prohibido,
sin `pause-requested` y confirmación humana para cancelación activa. La propuesta anterior queda
solo como antecedente archivado. No se combinan ambos contratos ni se certifica su implementación.

La fase 10 conserva el bloqueo de su interfaz completa. Su párrafo antiguo que posponía el widget
hasta terminar esa interfaz se adapta a la excepción A+B aprobada el **2026-10-08**, sin ampliar
el alcance de esa excepción. B sigue requiriendo aceptación humana de A.

## Estructura canónica

Se crean **12 features**, con **12 specs, 5 planes y 5 registros de tareas**. Los números 000–010
representan las fases 00–10. `011-widget-subagentes` representa la excepción A+B, **no fase 11**.

```text
.specify/                  constitución, plantillas, scripts e integración (sin mover specs aquí)
specs/
├── README.md              índice y selección explícita
├── ROADMAP.md             gates, dependencias y estados registrados
├── MIGRATION.md           este informe
├── MIGRATION.json         hashes y trazabilidad de importación
├── 000-.../               spec.md, plan.md, tasks.md
├── 001-.../               spec.md, plan.md, tasks.md
├── 002-.../               spec.md, plan.md, tasks.md
├── 003-eventos-rpc/        spec.md, plan.md, tasks.md
├── 004-.../ a 010-.../     solo spec.md: propuestas bloqueadas
├── 011-widget-subagentes/ spec.md, plan.md, tasks.md
└── _archive/pre-specify-2026-10-09/ originales y contexto
```

| Fase/entrega | Feature | Fuente normativa | Artefactos de planificación |
| --- | --- | --- | --- |
| 00 | [000-preparacion-arquitectonica](000-preparacion-arquitectonica/spec.md) | Spec original | plan + tasks |
| 01 | [001-consulta-listado-espera](001-consulta-listado-espera/spec.md) | Spec original | plan + tasks |
| 02 | [002-control-ciclo-de-vida](002-control-ciclo-de-vida/spec.md) | Spec original | plan + tasks |
| 03 | [003-eventos-rpc](003-eventos-rpc/spec.md) | Diseño aprobado + propuesta archivada | plan + tasks |
| 04 | [004-resultados-estructurados-gates](004-resultados-estructurados-gates/spec.md) | Spec original | sin plan ni tasks |
| 05 | [005-grupos-join](005-grupos-join/spec.md) | Spec original | sin plan ni tasks |
| 06 | [006-aislamiento-worktrees](006-aislamiento-worktrees/spec.md) | Spec original | sin plan ni tasks |
| 07 | [007-steering-durable](007-steering-durable/spec.md) | Spec original | sin plan ni tasks |
| 08 | [008-scheduling-durable](008-scheduling-durable/spec.md) | Spec original | sin plan ni tasks |
| 09 | [009-workflows-declarativos](009-workflows-declarativos/spec.md) | Spec original | sin plan ni tasks |
| 10 | [010-interfaz-operativa](010-interfaz-operativa/spec.md) | Spec original | sin plan ni tasks |
| A+B | [011-widget-subagentes](011-widget-subagentes/spec.md) | Diseño aprobado + propuesta archivada | plan + tasks |

### Adaptación a las plantillas

- Specs: metadata de migración y estado, historias priorizadas, escenarios Given/When/Then,
  prueba independiente, FR de índice, entidades, requisitos de dominio y aceptación preservados.
- Los FR y SC añadidos organizan alcance y verificación; **no sustituyen RF/AC ni crean capacidades**.
- Planes: resumen, contexto técnico, Constitution Check documental, estructura, complejidad,
  detalle técnico y secuencia; los comandos y pasos pasan a tasks.md, sin duplicar backlog.
- Tasks: IDs T001… por feature, asociaciones US1/US2, rutas de alcance, pruebas y orden explícito.
  Cada bloque mantiene sus pasos rojos/verdes, comandos y compromisos de revisión.
- No se inventan `research.md`, `data-model.md`, `quickstart.md` ni archivos de contratos separados
  donde no existían; el contenido de esos contratos permanece dentro de spec/plan/tasks.
- Se eliminan mandatos de subskills Superpowers del encabezado operativo. Las notas originales
  de revisión se conservan como antecedentes; no se cambia el método humano elegido.

### Casillas y dependencias preservadas

Hay **226 pasos importados**, **74 marcados** en sus originales; la migración no marcó ninguno.
Los bloques T1… originales se corresponden con rangos de nuevos IDs en cada tasks.md.

| Feature | Bloques originales | Pasos Tnnn | Casillas marcadas de origen |
| --- | --- | --- | --- |
| [000-preparacion-arquitectonica](000-preparacion-arquitectonica/tasks.md) | 11 | 71 | 71 |
| [001-consulta-listado-espera](001-consulta-listado-espera/tasks.md) | 10 | 48 | 0 |
| [002-control-ciclo-de-vida](002-control-ciclo-de-vida/tasks.md) | 8 | 38 | 0 |
| [003-eventos-rpc](003-eventos-rpc/tasks.md) | 9 | 53 | 0 |
| [011-widget-subagentes](011-widget-subagentes/tasks.md) | 3 | 16 | 3 |

El orden se mantiene secuencial: cada paso depende del anterior. **No se asigna [P]** sin evidencia
de independencia. Los cuatro pasos previos de fase 03 permanecen antes de sus nueve bloques.
Widget US2/B depende adicionalmente de aceptación humana de US1/A.

**Fases 000–002 son registros históricos, no backlog ejecutable.** La adopción de Spec Kit no
habilita reejecutar migraciones, recrear código ni repetir commits descritos en esos planes.

## Discrepancias y seguimiento humano

| Hallazgo | Tratamiento en la migración | Seguimiento pendiente |
| --- | --- | --- |
| Spec 00 decía no implementada; roadmap registra fase completada | Estado canónico referencia roadmap; original congelado | Contrastar evidencia antes de reutilizar plan histórico |
| README y aceptación 00 aún indican aceptación pendiente; roadmap tiene cierre humano | Se preserva evidencia; se etiquetan pasajes antiguos del roadmap como históricos | Reconciliar matrices y README mediante decisión humana; no inferir aceptación de todas las celdas |
| Planes 01 y 02 conservan 48 y 38 casillas vacías, pese al cierre registrado | Se importan vacías y se marca registro NO EJECUTAR | Reconciliar checklist si se desea cerrarlo, con evidencia real |
| Propuesta vieja 03 incompatible con diseño aprobado | Solo el diseño aprobado es normativo; propuesta archivada | Plan 03 y método siguen pendientes de revisión/elección |
| Widget adelanta una parte de 10, antes condicionado a UI completa | Excepción A+B registrada; condición obsoleta normalizada | Aceptar A antes de B, sin desbloquear otras capacidades |
| Plan widget usa Pi 1.1.0; README conserva host probado 1.0.4 | Se conservan ambas versiones y el alcance de la evidencia | Verificar API/host real antes de aceptación; no anunciar compatibilidad por documentación |
| Fases 04–10 tienen dependencias y decisiones sin cerrar | Solo specs, sin planes/tareas inventados | Autorizar la siguiente fase y resolver sus gates antes de planificar |
| El baseline 00 enlazaba `src/jobs.ts`, ya ausente | Se conserva como referencia histórica en texto, no como enlace roto | No reconstruir el archivo ni atribuir su inspección al árbol actual |
| Ratificación constitucional pendiente | Constitución intacta, pendiente existente conservada | Decisión humana y fecha de ratificación |

Estos hallazgos no se arreglan marcando casillas ni declarando pruebas verdes.
La migración tampoco audita cambios de runtime que ya estuvieran en el árbol de trabajo.

## Archivo y trazabilidad

[Archivo histórico](_archive/pre-specify-2026-10-09/ARCHIVE.md): **18 documentos migrados**
(11 specs, 5 planes y 2 diseños) y **8 snapshots de contexto** (índices, guía y aceptación).
Los originales se retiran de sus antiguas rutas una vez comprobada la copia; no se dejan stubs
ni enlaces operativos al árbol Superpowers. `.superpowers/` y worktrees se mantienen intactos.

[MIGRATION.json](MIGRATION.json) registra SHA-256 y tamaño de los 26 snapshots, fuente principal
por feature, plan de origen, casillas y rangos Tnnn. Las copias no se reescriben ni normalizan;
para interpretar enlaces y rutas relativos históricos, usar su árbol original conservado.

| Original archivado | Destino operativo |
| --- | --- |
| [`specs/00-preparacion-arquitectonica.md`](_archive/pre-specify-2026-10-09/specs/00-preparacion-arquitectonica.md) | [`specs/000-preparacion-arquitectonica/spec.md`](000-preparacion-arquitectonica/spec.md) |
| [`docs/superpowers/plans/2026-10-06-fase-00-preparacion-arquitectonica.md`](_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-06-fase-00-preparacion-arquitectonica.md) | [`specs/000-preparacion-arquitectonica/plan.md`](000-preparacion-arquitectonica/plan.md) |
| [`specs/01-consulta-listado-espera.md`](_archive/pre-specify-2026-10-09/specs/01-consulta-listado-espera.md) | [`specs/001-consulta-listado-espera/spec.md`](001-consulta-listado-espera/spec.md) |
| [`docs/superpowers/plans/2026-10-06-fase-01-consulta-listado-espera.md`](_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-06-fase-01-consulta-listado-espera.md) | [`specs/001-consulta-listado-espera/plan.md`](001-consulta-listado-espera/plan.md) |
| [`specs/02-control-ciclo-de-vida.md`](_archive/pre-specify-2026-10-09/specs/02-control-ciclo-de-vida.md) | [`specs/002-control-ciclo-de-vida/spec.md`](002-control-ciclo-de-vida/spec.md) |
| [`docs/superpowers/plans/2026-10-07-fase-02-control-ciclo-vida.md`](_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-07-fase-02-control-ciclo-vida.md) | [`specs/002-control-ciclo-de-vida/plan.md`](002-control-ciclo-de-vida/plan.md) |
| [`specs/03-eventos-rpc.md`](_archive/pre-specify-2026-10-09/specs/03-eventos-rpc.md) | [`specs/003-eventos-rpc/spec.md`](003-eventos-rpc/spec.md) |
| [`docs/superpowers/specs/2026-10-07-fase-03-eventos-rpc-design.md`](_archive/pre-specify-2026-10-09/docs/superpowers/specs/2026-10-07-fase-03-eventos-rpc-design.md) | [`specs/003-eventos-rpc/spec.md`](003-eventos-rpc/spec.md) |
| [`docs/superpowers/plans/2026-10-07-fase-03-eventos-rpc.md`](_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-07-fase-03-eventos-rpc.md) | [`specs/003-eventos-rpc/plan.md`](003-eventos-rpc/plan.md) |
| [`specs/04-resultados-estructurados-gates.md`](_archive/pre-specify-2026-10-09/specs/04-resultados-estructurados-gates.md) | [`specs/004-resultados-estructurados-gates/spec.md`](004-resultados-estructurados-gates/spec.md) |
| [`specs/05-grupos-join.md`](_archive/pre-specify-2026-10-09/specs/05-grupos-join.md) | [`specs/005-grupos-join/spec.md`](005-grupos-join/spec.md) |
| [`specs/06-aislamiento-worktrees.md`](_archive/pre-specify-2026-10-09/specs/06-aislamiento-worktrees.md) | [`specs/006-aislamiento-worktrees/spec.md`](006-aislamiento-worktrees/spec.md) |
| [`specs/07-steering-durable.md`](_archive/pre-specify-2026-10-09/specs/07-steering-durable.md) | [`specs/007-steering-durable/spec.md`](007-steering-durable/spec.md) |
| [`specs/08-scheduling-durable.md`](_archive/pre-specify-2026-10-09/specs/08-scheduling-durable.md) | [`specs/008-scheduling-durable/spec.md`](008-scheduling-durable/spec.md) |
| [`specs/09-workflows-declarativos.md`](_archive/pre-specify-2026-10-09/specs/09-workflows-declarativos.md) | [`specs/009-workflows-declarativos/spec.md`](009-workflows-declarativos/spec.md) |
| [`specs/10-interfaz-operativa.md`](_archive/pre-specify-2026-10-09/specs/10-interfaz-operativa.md) | [`specs/010-interfaz-operativa/spec.md`](010-interfaz-operativa/spec.md) |
| [`docs/superpowers/specs/2026-10-08-widget-subagentes-design.md`](_archive/pre-specify-2026-10-09/docs/superpowers/specs/2026-10-08-widget-subagentes-design.md) | [`specs/011-widget-subagentes/spec.md`](011-widget-subagentes/spec.md) |
| [`docs/superpowers/plans/2026-10-08-widget-subagentes.md`](_archive/pre-specify-2026-10-09/docs/superpowers/plans/2026-10-08-widget-subagentes.md) | [`specs/011-widget-subagentes/plan.md`](011-widget-subagentes/plan.md) |

## Validación

Validación ejecutada el **2026-10-09**, mediante autocomprobaciones con `node:assert/strict`
y los scripts locales. Esta sección **no equivale a prueba de producto ni aceptación TUI**.

| Comprobación ejecutada | Resultado |
| --- | --- |
| Archivo: tamaño y SHA-256 de 26 snapshots | Pasa; originales intactos |
| Fuentes migradas retiradas de 18 rutas antiguas | Pasa; sin segundo backlog operativo |
| 12 specs y secciones obligatorias; 5 planes/tareas | Pasa; las siete fases bloqueadas siguen sin plan/tareas |
| IDs RF/AC y bloques técnicos de fuentes normativas | Pasa; contratos preservados, salvo referencias documentales rebased |
| 226 pasos secuenciales y casillas comparadas una a una | Pasa; 74 marcadas de origen, ninguna marcada por la migración |
| 32 documentos: fences, tablas, whitespace y placeholders de plantilla | Pasa; ningún mandato de subskill Superpowers operativo |
| 246 enlaces locales y dos anchors desde documentos operativos | Pasa; no enlaces a antiguas rutas retiradas |
| `check-prerequisites.sh`: 12 resoluciones sin inferir rama y 12 gates | Pasa; cinco features con tasks, siete rechazos esperados por ausencia de plan |
| Selección de feature durante pruebas de rutas | Sandbox temporal con SPECIFY_INIT_DIR; selección real intacta |
| Código/tests/configuración y constitución previos | Hash del diff de producto, settings y constitución iguales al inicio; docs de aceptación/arquitectura iguales al snapshot |
| `git diff --check` | Pasa |

No se comprobaron enlaces externos por red, render visual Markdown, comportamiento TUI ni pruebas
runtime del producto. Las evidencias archivadas no se revalidaron históricamente. El archivo
histórico conserva referencias al árbol anterior, que no deben tratarse como rutas operativas.

No se ejecutan `setup-plan.sh` ni `setup-tasks.sh`: pueden reemplazar artefactos existentes.
No se ejecutan hooks, no se selecciona una feature permanente y no se refresca AGENTS hacia
un plan arbitrario. La selección explícita se explica en [specs/README.md](README.md).
