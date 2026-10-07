# 10 — Interfaz operativa y observabilidad humana

## Estado y dependencias

Propuesta. Última fase; depende de 01–09. La UI consume contratos existentes y no introduce semántica de negocio nueva.

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

Después de validar la interfaz principal puede añadirse un widget compacto encima del editor:

```text
Subagentes: 2 activos · 3 en cola · 1 revisión · 1 workflow esperando aprobación
```

Predeterminado: apagado o resumen de una línea. No se implementan inicialmente animaciones por job ni conversaciones en vivo. El widget abre `/subagents` y no captura flechas del editor de forma invasiva.

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

- Estado no depende solo de color; usa texto/símbolo.
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

## Pruebas

- Componentes con anchos, alturas y temas variados.
- Navegación y foco; Escape/Ctrl+C sin cancelar job.
- Snapshots de estados y errores.
- Resultados grandes, ANSI, Markdown malformado y Unicode.
- Actualización con eventos duplicados, perdidos y fuera de orden.
- Confirmaciones y actor humano.
- Modos TUI, print y RPC.
- Pruebas de rendimiento basadas en operaciones, no tiempos frágiles.
- Integración de cada capacidad 01–09.

## Fuera de alcance inicial

- Réplica exacta de FleetView upstream.
- Clon invisible de conversaciones y menciones `@agente`.
- Streaming completo de cada token.
- Editor visual de workflows.
- Promoción, merge, push o publicación.
