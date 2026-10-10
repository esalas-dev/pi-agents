# 10 — Interfaz operativa y observabilidad humana

## Estado y dependencias

Propuesta. Última fase; depende de 01–09. La UI consume contratos existentes y no introduce semántica de negocio nueva.

La [spec acotada del widget de subagentes](../docs/superpowers/specs/2026-10-08-widget-subagentes-design.md) y su plan fueron aprobados humanamente el 2026-10-08; se implementan A y B bajo una excepción limitada registrada en roadmap e índice. Esto no sustituye esta fase ni altera la dependencia 01–09 de la interfaz operativa completa.

## Objetivo

Ofrecer una interfaz TUI coherente para observar y operar jobs, grupos, schedules y workflows, con confirmaciones y trazabilidad adecuadas. Debe mejorar la supervisión sin ocultar estados durables ni enviar datos al modelo.

## Principios

- La UI es una proyección; nunca la fuente de verdad.
- Todas las acciones llaman servicios de dominio usados por comandos/tools/RPC.
- Cerrar una vista no cancela operaciones.
- El estado se vuelve a leer después de cada acción.
- La vista diferencia éxito técnico, gate, revisión y promoción.
- No se usa `/agents` para evitar colisión con upstream. Comando raíz: `/subagents`.

## Navegación

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

## Vista de trabajos

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

### Detalle

Pestañas o secciones:

1. **Resumen**: snapshot, actor, timestamps, estado y error.
2. **Resultado**: texto/JSON, truncado explícito y hash.
3. **Verificación**: schemas y gates con salida acotada.
4. **Control**: historial pause/resume/cancel/retry.
5. **Steering**: mensajes, actores y entrega.
6. **Worktree**: base, rama, commit, fase y limpieza.
7. **Auditoría**: eventos y consumos.

Resultados pendientes se pueden leer humanamente. Botones separados `Aprobar` y `Rechazar`; leer no aprueba.

## Acciones y confirmación

### Sin confirmación adicional

- refrescar;
- filtrar;
- copiar ID;
- abrir resultado/log truncado;
- esperar/seguir estado;
- volver/cerrar.

### Confirmación simple

- pausar/reanudar job;
- sellar grupo;
- pausar/reanudar schedule;
- enviar steering, mostrando que no revierte efectos previos.

### Confirmación fuerte

Requiere mostrar objeto afectado y consecuencia, y escribir/seleccionar confirmación:

- cancelar job activo;
- retry que pueda repetir efectos;
- cancelar miembros de grupo;
- descartar worktree con cambios;
- eliminar schedule;
- cancelar workflow;
- aprobar/rechazar resultado o step.

No se agrupan aprobación y promoción en una misma acción.

## Actualización en vivo

- Suscripción a eventos de fase 03 para refresco eficiente.
- Relectura durable periódica como respaldo, con intervalo adaptativo.
- Eventos duplicados solo disparan refresco; no mutan estado localmente.
- Al perder/reabrir sesión se invalidan vistas y cursores.
- Indicador visible de «datos desactualizados» si falla la consulta.

Objetivo de render: no recorrer resultados completos ni transcripts en cada frame. Listados trabajan con vistas compactas. Contenido grande se carga al abrir detalle y se pagina.

## Widget opcional

Después de validar la interfaz principal puede añadirse el widget compacto de la [spec acotada](../docs/superpowers/specs/2026-10-08-widget-subagentes-design.md), encima del editor:

```text
Subagentes · 2 visibles
| psa_7ab… reviewer     ejecutándose  42 s
○ psa_318… tester       en cola        —
```

Su política de visibilidad es automática: se muestra mientras una consulta exitosa devuelva jobs no terminales visibles y se retira si una consulta exitosa no devuelve ninguno. No aparece vacío ni necesita un ajuste para activarse. Se incluye un spinner para jobs activos: frames de una columna, un único reloj compartido de 250 ms y texto de estado permanente. No representa porcentaje ni prueba de avance efectivo.

Queued/paused y terminales no animan; datos desactualizados, ausencia de filas activas o widget retirado detienen el reloj. Los ticks no disparan consultas ni llamadas al modelo; animación y actividad comparten el presupuesto de render. `PI_AGENTS_ANIMATION=0` permitirá movimiento reducido sin perder información ni refresco. La etapa B de la spec acotada muestra solo señales técnicas allowlisted; no presenta una vista de conversación ni el transcript. El widget abre `/subagents` y no captura flechas del editor de forma invasiva.

## Recursos y recuperación

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

## Schedules

La UI muestra:

- próxima ocurrencia en zona declarada y UTC;
- política de misfire;
- snapshot/hash;
- actor;
- última ocurrencia y job;
- estado.

Crear schedule por wizard humano valida cada paso antes del resumen final. No preselecciona `catch_up` ni frecuencias agresivas.

## Workflows

Dos niveles:

1. lista de runs con estado/progreso;
2. DAG o lista topológica de steps.

Un step muestra sus jobs/grupo/gate y dependencias. `approval` ocupa una vista específica con hash de artefactos y enlaces a evidencia. La UI no resume hallazgos mediante otro modelo salvo futura función explícita.

## Accesibilidad y formato

- Estado no depende solo de color ni de animación; usa texto/símbolo.
- Permite movimiento reducido con símbolos estáticos, sin destellos ni saltos de layout.
- Respeta keybindings de Pi cuando exista API pública.
- Trunca con indicador y permite expandir.
- No interpreta stdout como Markdown por defecto.
- Sanitiza secuencias de terminal en contenido no confiable.
- Copiar secretos o resultados completos requiere acción consciente.
- Mensajes y comandos de usuario se presentan en español; códigos de error se conservan.

## Headless y compatibilidad

- La extensión sigue funcionando en `--print`, JSON y RPC sin UI interactiva.
- `/subagents` existente conserva subcomandos.
- `/subagents` abre panel solo cuando existe TUI; en headless devuelve ayuda textual o error estable.
- Deshabilitar UI no deshabilita ejecución, consultas ni RPC.

## Configuración propuesta

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

## Telemetría local

Sin enviar datos externos, medir opcionalmente:

- duración de consultas;
- tiempo de render;
- cantidad de filas procesadas;
- eventos duplicados observados;
- fallos de reconciliación.

Estas métricas sirven para pruebas y diagnóstico, no contienen prompts ni resultados.

## Criterios de aceptación

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

## Pruebas

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

## Fuera de alcance inicial

- Réplica exacta de FleetView upstream.
- Clon invisible de conversaciones y menciones `@agente`.
- Streaming completo de cada token.
- Editor visual de workflows.
- Promoción, merge, push o publicación.
