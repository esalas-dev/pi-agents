# pi-durable-subagents

Paquete instalable para Pi que ejecuta **un agente y una tarea por invocación** en una conversación aislada y durable, en segundo plano y dentro del mismo proceso. Devuelve inmediatamente un ID, limita la concurrencia, persiste el trabajo en SQLite y notifica su finalización en la sesión principal.

## Requisitos

- Node.js `>=26.10.0`.
- Pi **1.0.4** es el host objetivo del type-check y del smoke de carga actual. La aceptación TUI humana del rediseño sigue pendiente; véase `docs/PHASE-00-ACCEPTANCE.md`.
- Entorno de desarrollo comprobado: macOS arm64 con Node `26.10.0`. No se afirma compatibilidad probada de todas las versiones superiores.
- Agentes Markdown en `~/.pi/agent/agents/` o en el `.pi/agents/` más cercano del proyecto.
- Un modelo configurado en Pi.

`@earendil-works/pi-durable` está fijado exactamente en `1.0.1` porque su API se declara experimental y puede cambiar sin aviso.

## Instalación local

Para una instalación local desde el código fuente, instala primero las dependencias propias del paquete —Pi no modifica paquetes locales— y después regístralo desde cualquier directorio:

```sh
cd /ruta/a/pi-durable-subagents
npm install --omit=peer
pi install /ruta/a/pi-durable-subagents
pi list
```

Pi registra una referencia a esta carpeta; no debe moverse sin reinstalar el paquete. Después de modificar el código usa `/reload` o reinicia Pi. Para retirarlo:

```sh
pi remove /ruta/a/pi-durable-subagents
```

La instalación debe ser personal, sin `--local`, si se desea disponer de la extensión en distintos proyectos.

## Formato de agentes

```markdown
---
name: reviewer
description: Revisa una implementación sin modificarla
tools: read, bash
model: openai-codex/gpt-5.4
---

Eres un revisor independiente. Examina el código y reporta hallazgos concretos.
```

Campos:

- `name` y `description`: obligatorios.
- `tools`: cadena separada por comas o arreglo YAML. Si se omite, se habilitan las cuatro herramientas soportadas.
- `model`: opcional; usa la misma sintaxis de `--model`. Si se omite, hereda el modelo principal.
- cuerpo Markdown: instrucciones del agente.

Se admiten únicamente `read`, `write`, `edit` y `bash`. Un agente que solicite otra herramienta se rechaza antes de encolarse, indicando los nombres incompatibles.

Los agentes del proyecto reemplazan por nombre a los personales. Solo se leen cuando Pi informa que el proyecto está confiado mediante `ctx.isProjectTrusted()`. Si no lo está, se ignoran y el mensaje de error recomienda usar `/trust`; la extensión no implementa un mecanismo paralelo de aprobación.

## Uso manual

```text
/pi-agents <agente> "<tarea>"
/pi-agents status <id>
/pi-agents result <id>
```

Ejemplo:

```text
/pi-agents reviewer "Revisa los cambios actuales y prioriza defectos funcionales"
```

El inicio agrega una entrada con un ID como `psa_7ab31c01db62`. `status` muestra estado, agente, modelo, cwd, duración y error. `result` añade además la respuesta final completa cuando está disponible.

Estados públicos:

- `queued`
- `running`
- `completed`
- `failed`
- `interrupted`

`provisioning` es interno y se presenta como `running`.

## Uso automático

La extensión registra `pi_agents`:

```json
{
  "agent": "reviewer",
  "task": "Revisa la implementación actual"
}
```

La herramienta siempre representa una sola tarea. Retorna al agente principal en cuanto el trabajo queda persistido y encolado; no espera el resultado. Al finalizar se añade a la sesión principal una entrada no enviada al modelo con el ID y un resumen breve.

## Persistencia y recuperación

Cada sesión principal tiene su propio almacenamiento:

```text
~/.pi/agent/pi-agents/sessions/<session-id>.sqlite
```

La separación por sesión evita mezclar resultados y reduce conflictos entre procesos Pi distintos. Al cambiar de sesión o cerrar Pi, el Harness Durable se cierra ordenadamente. Al volver a abrir esa sesión:

- trabajos en cola siguen en cola;
- conversaciones y envíos conservan su identidad;
- generaciones interrumpidas continúan desde su checkpoint;
- herramientas seguras pueden repetirse según las reglas de Pi Durable;
- herramientas no seguras producen el tratamiento `interrupted` de Pi Durable en vez de repetir ciegamente efectos;
- resultados ya confirmados no vuelven a ejecutarse.

La entrega usa un `requestId` derivado del ID del trabajo, de modo que una caída entre el envío y el registro local recupera el mismo envío en lugar de duplicarlo. Las bases v1 requieren mantenimiento humano explícito, backup verificado y conversión atómica; una base legacy no se abre directamente.

## Concurrencia y configuración

Por defecto se ejecutan cuatro trabajos simultáneamente. El resto queda durablemente encolado.

```sh
PI_AGENTS_CONCURRENCY=2 pi
```

El valor válido es de 1 a 16. También puede cambiarse el directorio base de estado:

```sh
PI_AGENTS_STATE_DIR=/ruta/privada pi
```

La carpeta de estado puede contener instrucciones, respuestas, rutas, argumentos de herramientas y fragmentos de archivos. Debe tratarse como información sensible.

## Límites de esta versión

- No hay cancelación, listado global, logs en vivo ni timeout propio.
- No se puentean herramientas de la sesión principal, MCP, codemode ni herramientas de otras extensiones. Pi no expone una API pública para ejecutarlas después de que la llamada original haya terminado.
- Los modelos virtuales cuya definición no puede reconstruirse mediante la API pública se rechazan. Los proveedores físicos registrados en la sesión se copian al runtime durable mediante APIs públicas.
- `read` de Pi Durable no soporta imágenes actualmente.
- El aislamiento es de conversación y contexto, **no de seguridad**. Los subagentes tienen los permisos del proceso Pi y el cwd no impide acceder a otras rutas. Para aislamiento real usa un contenedor, sandbox o VM.
- Un mismo archivo SQLite debe pertenecer a un solo proceso. La separación por ID de sesión reduce el riesgo, pero no permite abrir deliberadamente la misma sesión principal en dos procesos concurrentes.
- Pi Durable es experimental. Antes de actualizarlo hay que revisar su changelog, recompilar conceptualmente los contratos y repetir las pruebas de recuperación.

## Desarrollo y pruebas

```sh
npm install --omit=peer
npm run check
npm test
```

`npm run check` ejecuta TypeScript estricto sin emisión y comprueba la sintaxis de todos los `.ts` productivos. Descubre el Pi de `PATH`; para otra instalación, define `PI_AGENTS_PI_PACKAGE_ROOT` con la raíz de su paquete. Las rutas locales se generan en `.cache/pi-agents/tsconfig.host.json`, ignorado por Git; no modifican la resolución runtime. El chequeo de sintaxis utiliza `stripTypeScriptTypes`, API pública experimental de Node que emite una advertencia informativa.

Se usa `skipLibCheck: true`, autorizado ante errores en declaraciones upstream: se comprueba el código propio y su uso de tipos importados, pero no la consistencia interna de los `.d.ts` de dependencias. Esto no sustituye las pruebas de integración con Pi. El proyecto resuelve `pi-ai 1.0.1` localmente y el host inspeccionado incluye `1.0.4`.

Los `peerDependencies` son suministrados por Pi y no deben añadirse como dependencias runtime directas. Las dependencias transitivas de Pi Durable se inventarían por separado; no se asume que coinciden con las del host. Las pruebas cubren:

- descubrimiento personal/proyecto y precedencia;
- confianza del proyecto;
- validación de herramientas;
- sintaxis del comando;
- ejecución y persistencia SQLite;
- locks, inspección de versiones, backup, migración v1 y recuperación del runtime;
- adaptadores Pi, autoridad TUI-only y smoke de carga.
- límite de concurrencia;
- cierre y reapertura durante una generación.

Para verificar que Pi puede cargar el paquete sin invocar un modelo:

```sh
PI_OFFLINE=1 pi --no-extensions \
  --extension /ruta/a/pi-durable-subagents/index.ts \
  --list-models __pi_agents_smoke_no_match__
```

Consulta [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) para los estados, límites de atomicidad y decisiones de diseño.
