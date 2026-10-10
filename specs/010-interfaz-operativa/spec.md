# Feature Specification: Interfaz operativa y observabilidad humana

**Feature Branch**: `010-interfaz-operativa` (identificador documental; no se creó una rama Git)

**Created**: 2026-10-09 (migración; las fechas originales se conservan en las fuentes)

**Status**: propuesta bloqueada; la excepción widget A+B no habilita la fase completa

**Input**: Migración autorizada de documentación existente a Spec Kit, sin implementación nueva.

**Origen**: [documento original archivado](../_archive/pre-specify-2026-10-09/specs/10-interfaz-operativa.md).
El [informe de migración](../MIGRATION.md) registra autoridad, precedencia y discrepancias.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Supervisar capacidades durables desde una TUI coherente (Priority: P1)

Operar jobs, grupos, schedules y workflows sin nueva semántica de negocio ni exposición al modelo.

**Why this priority**: Es el caso de uso central del alcance existente; no añade capacidades.

**Independent Test**: Ejecutar los escenarios y criterios preservados en Success Criteria sobre
fixtures controladas, incluyendo recuperación y autoridad donde corresponda. No se ejecutaron
esas pruebas de producto durante la migración.

**Acceptance Scenarios**:

1. **Given** las dependencias satisfechas y el alcance autorizado, **When** la persona navega, consulta un resultado y cierra el panel,
   **Then** las vistas reflejan estado durable y cerrar o leer no cancela ni aprueba trabajos.
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
- **Estado de autorización**: Propuesta bloqueada. No hay plan ni tareas aprobados y no se generan en esta migración.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE reconstruir vistas desde servicios y snapshots, con carga diferida de resultados grandes.
- **FR-002**: El sistema DEBE exigir confirmaciones proporcionales, sin aprobar al leer ni cancelar al cerrar panel o espera.
- **FR-003**: El sistema DEBE sanitizar contenido hostil y mantener modos headless; conservar la excepción A+B como feature independiente.

Los FR anteriores son el índice del alcance, no sustituyen sus reglas detalladas. Los IDs RF,
AC y nombres de API originales se conservan para trazabilidad; no se reinterpretan como evidencia.

### Key Entities

- Vistas de job, grupo, schedule y workflow proyectan servicios existentes.
- Detalle, confirmación y contenido grande son presentación; no crean autoridad ni estado de negocio.

Los campos y relaciones detallados se preservan abajo; las propuestas no se consideran código local.

### Requisitos de dominio preservados

### Objetivo

Ofrecer una interfaz TUI coherente para observar y operar jobs, grupos, schedules y workflows, con confirmaciones y trazabilidad adecuadas. Debe mejorar la supervisión sin ocultar estados durables ni enviar datos al modelo.

### Principios

- La UI es una proyección; nunca la fuente de verdad.
- Todas las acciones llaman servicios de dominio usados por comandos/tools/RPC.
- Cerrar una vista no cancela operaciones.
- El estado se vuelve a leer después de cada acción.
- La vista diferencia éxito técnico, gate, revisión y promoción.
- No se usa `/agents` para evitar colisión con upstream. Comando raíz: `/subagents`.

### Navegación

```text
/subagents
├─ Trabajos
│  ├─ Activos
│  ├─ En cola/pausados
│  ├─ Pendientes de revisión
│  └─ Historial
├─ Grupos
├─ Schedules
├─ Workflows
├─ Recursos y recuperación
└─ Configuración
```

La UI debe funcionar con teclado, terminal estrecha y temas claros/oscuros. Ninguna funcionalidad esencial depende del ratón.

### Vista de trabajos

Columnas adaptativas:

- estado e indicador durable;
- ID corto;
- agente;
- resumen de tarea;
- fase actual;
- antigüedad/duración;
- revisión;
- grupo/workflow;
- modelo, opcional.

Filtros reutilizan `listJobs`. El orden y paginación son del servicio, no reimplementados en el componente.

#### Detalle

Pestañas o secciones:

1. **Resumen**: snapshot, actor, timestamps, estado y error.
2. **Resultado**: texto/JSON, truncado explícito y hash.
3. **Verificación**: schemas y gates con salida acotada.
4. **Control**: historial pause/resume/cancel/retry.
5. **Steering**: mensajes, actores y entrega.
6. **Worktree**: base, rama, commit, fase y limpieza.
7. **Auditoría**: eventos y consumos.

Resultados pendientes se pueden leer humanamente. Botones separados `Aprobar` y `Rechazar`; leer no aprueba.

### Acciones y confirmación

#### Sin confirmación adicional

- refrescar;
- filtrar;
- copiar ID;
- abrir resultado/log truncado;
- esperar/seguir estado;
- volver/cerrar.

#### Confirmación simple

- pausar/reanudar job;
- sellar grupo;
- pausar/reanudar schedule;
- enviar steering, mostrando que no revierte efectos previos.

#### Confirmación fuerte

Requiere mostrar objeto afectado y consecuencia, y escribir/seleccionar confirmación:

- cancelar job activo;
- retry que pueda repetir efectos;
- cancelar miembros de grupo;
- descartar worktree con cambios;
- eliminar schedule;
- cancelar workflow;
- aprobar/rechazar resultado o step.

No se agrupan aprobación y promoción en una misma acción.

### Actualización en vivo

- Suscripción a eventos de fase 03 para refresco eficiente.
- Relectura durable periódica como respaldo, con intervalo adaptativo.
- Eventos duplicados solo disparan refresco; no mutan estado localmente.
- Al perder/reabrir sesión se invalidan vistas y cursores.
- Indicador visible de «datos desactualizados» si falla la consulta.

Objetivo de render: no recorrer resultados completos ni transcripts en cada frame. Listados trabajan con vistas compactas. Contenido grande se carga al abrir detalle y se pagina.

### Widget opcional

El widget compacto de la [spec acotada](../011-widget-subagentes/spec.md) se adelanta solo por la
excepción humana A+B del 2026-10-08, encima del editor. No requiere completar esta interfaz ni
habilita sus otras capacidades:

```text
Subagentes · 2 visibles
| psa_7ab… reviewer     ejecutándose  42 s
○ psa_318… tester       en cola        —
```

Su política de visibilidad es automática: se muestra mientras una consulta exitosa devuelva jobs no terminales visibles y se retira si una consulta exitosa no devuelve ninguno. No aparece vacío ni necesita un ajuste para activarse. Se incluye un spinner para jobs activos: frames de una columna, un único reloj compartido de 250 ms y texto de estado permanente. No representa porcentaje ni prueba de avance efectivo.

Queued/paused y terminales no animan; datos desactualizados, ausencia de filas activas o widget retirado detienen el reloj. Los ticks no disparan consultas ni llamadas al modelo; animación y actividad comparten el presupuesto de render. `PI_AGENTS_ANIMATION=0` permitirá movimiento reducido sin perder información ni refresco. La etapa B de la spec acotada muestra solo señales técnicas allowlisted; no presenta una vista de conversación ni el transcript. El widget abre `/subagents` y no captura flechas del editor de forma invasiva.

### Recursos y recuperación

Vista diagnóstica:

- ruta SQLite activa;
- versión de documentos/migraciones;
- propietario/proceso;
- jobs en reconciliación;
- eventos outbox pendientes;
- worktrees administrados y limpieza fallida;
- capacidades de Pi Durable detectadas;
- versión de Pi y Pi Durable;
- últimos errores operativos.

Acciones de reparación deben ser explícitas, conservadoras y documentadas. Nunca «limpiar todo» sin listar artefactos.

### Schedules

La UI muestra:

- próxima ocurrencia en zona declarada y UTC;
- política de misfire;
- snapshot/hash;
- actor;
- última ocurrencia y job;
- estado.

Crear schedule por wizard humano valida cada paso antes del resumen final. No preselecciona `catch_up` ni frecuencias agresivas.

### Workflows

Dos niveles:

1. lista de runs con estado/progreso;
2. DAG o lista topológica de steps.

Un step muestra sus jobs/grupo/gate y dependencias. `approval` ocupa una vista específica con hash de artefactos y enlaces a evidencia. La UI no resume hallazgos mediante otro modelo salvo futura función explícita.

### Accesibilidad y formato

- Estado no depende solo de color ni de animación; usa texto/símbolo.
- Permite movimiento reducido con símbolos estáticos, sin destellos ni saltos de layout.
- Respeta keybindings de Pi cuando exista API pública.
- Trunca con indicador y permite expandir.
- No interpreta stdout como Markdown por defecto.
- Sanitiza secuencias de terminal en contenido no confiable.
- Copiar secretos o resultados completos requiere acción consciente.
- Mensajes y comandos de usuario se presentan en español; códigos de error se conservan.

### Headless y compatibilidad

- La extensión sigue funcionando en `--print`, JSON y RPC sin UI interactiva.
- `/subagents` existente conserva subcomandos.
- `/subagents` abre panel solo cuando existe TUI; en headless devuelve ayuda textual o error estable.
- Deshabilitar UI no deshabilita ejecución, consultas ni RPC.

### Configuración propuesta

```json
{
  "ui": {
    "enabled": true,
    "widget": "off",
    "refreshIntervalMs": 1000,
    "showModel": false,
    "showSensitivePaths": false
  }
}
```

La ubicación definitiva de configuración debe seguir convenciones de Pi y documentar precedencia global/proyecto. El proyecto solo puede influir después de confianza.

### Telemetría local

Sin enviar datos externos, medir opcionalmente:

- duración de consultas;
- tiempo de render;
- cantidad de filas procesadas;
- eventos duplicados observados;
- fallos de reconciliación.

Estas métricas sirven para pruebas y diagnóstico, no contienen prompts ni resultados.

### Fuera de alcance inicial

- Réplica exacta de FleetView upstream.
- Clon invisible de conversaciones y menciones `@agente`.
- Streaming completo de cada token.
- Editor visual de workflows.
- Promoción, merge, push o publicación.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Se satisfacen todos los criterios de aceptación originales preservados a continuación,
  con evidencia por escenario y sin convertir resultados técnicos en aprobación humana.
- **SC-002**: Para una entrega de código, `npm run check` y `npm test` pasan; integración Pi añade
  smoke, y cambios TUI añaden aceptación humana aplicable. Un fallo conocido no cierra el gate.

### Criterios de aceptación

1. Todas las vistas se reconstruyen desde servicios y snapshots.
2. Cerrar panel o espera no cancela jobs.
3. Leer resultado no lo aprueba.
4. Acciones destructivas exigen confirmación proporcional.
5. Eventos duplicados no duplican acciones ni filas.
6. Un resultado de decenas de MiB no se reescanea en cada render.
7. Terminal estrecha conserva IDs, estado y acción de retorno.
8. Contenido con secuencias ANSI no puede alterar la TUI.
9. Headless sigue operativo con UI deshabilitada.
10. Workflows pendientes de aprobación son visibles y no avanzan solos.
11. Animación comparte un reloj de 250 ms, no incrementa consultas y se detiene ante datos desactualizados, retirada o cierre; modo estático conserva información y no deja ticks tardíos.

### Pruebas

- Componentes con anchos, alturas y temas variados.
- Navegación y foco; Escape/Ctrl+C sin cancelar job.
- Snapshots de estados y errores.
- Resultados grandes, ANSI, Markdown malformado y Unicode.
- Actualización con eventos duplicados, perdidos y fuera de orden.
- Confirmaciones y actor humano.
- Modos TUI, print y RPC.
- Pruebas de rendimiento basadas en operaciones, no tiempos frágiles.
- Frames con reloj simulado, movimiento reducido, render agrupado, ausencia de consultas por tick y limpieza de animación en reload/cambio de sesión.
- Integración de cada capacidad 01–09.

## Assumptions

- La migración conserva alcance, IDs, decisiones y evidencia; no certifica ejecución actual.
- La fecha de creación anterior no se infiere: el archivo conserva el documento y su cronología.
- El estado operativo procede del roadmap y evidencia enlazada, no de frases antiguas de planificación.
- Propuesta bloqueada. No hay plan ni tareas aprobados y no se generan en esta migración.
