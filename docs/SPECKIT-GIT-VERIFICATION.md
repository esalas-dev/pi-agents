# Verificación de Spec Kit y Git

Fecha: 2026-10-09. Entorno observado: Spec Kit 0.11.9, Node 26.10.0, Pi 1.1.0.

## Resultado inicial (antes de instalar la extensión Git)

El core de Spec Kit funciona dentro de un repositorio Git y de un linked worktree,
pero **no crea ni selecciona ramas Git**. `BRANCH_NAME` en la salida de
`create-new-feature.sh` es un identificador de feature, no evidencia de una rama creada.
La selección procede de `SPECIFY_FEATURE_DIRECTORY` o `.specify/feature.json`;
no se infiere de la rama. Esto coincide con la gobernanza local.

Solo está instalada la extensión `agent-context` 1.0.0. No hay extensión Git ni
hook `before_specify` para crear ramas. La integración Pi está registrada.

## Comprobaciones ejecutadas

Se ejecutaron autocomprobaciones Node con `node:assert/strict` y los scripts locales,
en una carpeta temporal con repositorio Git y linked worktree de prueba. La carpeta
se eliminó al finalizar; sus ramas y commit de prueba no pertenecen al repositorio real.

| Comprobación | Resultado |
| --- | --- |
| `bash -n` sobre los cinco scripts | Pasa |
| Sin selección explícita, rechazo sin inferir feature desde Git | Pasa |
| Resolución de las 12 features; cinco gates de plan/tareas válidos y siete rechazos esperados | Pasa |
| Persistencia de selección relativa, sin cambio de rama | Pasa |
| Dry-run de nueva feature 012, sin archivos ni rama nuevos | Pasa |
| Creación core de spec y selección, sin crear rama ni cambiar HEAD | Pasa |
| Selección en linked worktree; setup de plan/tareas preserva archivos existentes | Pasa |
| Estado Git y selector del repositorio real idénticos antes/después | Pasa |

Resultado: **8/8 comprobaciones**, exit 0. `git diff --check`: exit 0.
También se inspeccionaron `specify --version`, `specify extension list`, scripts,
registry, hooks, manifiesto Pi, `git status`, ramas, refs remotas locales y worktrees.
Estas comprobaciones no equivalen a pruebas runtime del paquete ni a aceptación TUI.

## Hallazgos pendientes de decisión

1. `.gitignore` ignora todo `.pi/`, incluidos los once prompts `speckit.*.md`.
   Un clon no recibiría esos prompts. `.pi/settings.json` y agentes locales deben
   permanecer privados; se puede permitir únicamente los prompts de Spec Kit.
2. `.specify/`, `.agents/`, `AGENTS.md` y la migración canónica de specs aún no
   están versionados. No se han añadido al índice ni creado commits.
3. `.specify/feature.json` no existe actualmente y no tiene regla de ignore.
   Los scripts lo crean al seleccionar una feature. Debe decidirse si se mantiene
   como estado local, especialmente al alternar entre 011 y 003.
4. La creación automática de ramas requeriría instalar/configurar la extensión Git.
   No es necesaria para usar Spec Kit con ramas/worktrees administrados manualmente.

## Deriva entre checkout, documentación y refs Git

- Checkout: `main`, HEAD `135856d5b5abf13379b5b5ef1f0d3040b448b6cd`.
- Ref remota local: `origin/main`, `94288cc`; `git rev-list --left-right --count
  main...origin/main` devuelve **0 / 53**. El checkout es antecesor de esa ref.
- Solo hay un worktree registrado; `.worktrees/` no contiene el código del widget.
- `origin/main` ya incluye PR #12 del widget A+B, código del widget, observación
  LiveDoc, pruebas y `docs/WIDGET-ACCEPTANCE.md`. Ese informe registra visto bueno
  humano A+B, pero distingue ejercicios TUI específicos y revisión independiente pendientes.
- `origin/main:docs/PHASE-03-ACCEPTANCE.md` y su roadmap describen 003 **en validación**,
  con RPC/outbox/cliente implementados y revisión independiente/aceptación TUI pendientes.
- La migración local se hizo sobre documentación anterior: no refleja esas entregas.
  No deben reimplementarse 011 ni 003 a partir de las casillas locales desactualizadas.

Se requiere elegir la base de continuación y reconciliar specs/planes/tareas con la
nueva evidencia sin borrar la migración, modificaciones de producto ni archivos históricos.
No se ha cambiado ninguna aprobación ni cerrado una fase.

## Instalación autorizada y revalidación

Después de la verificación, la persona responsable eligió un worktree desde
`origin/main` e instalar la extensión Git. Se creó `.worktrees/cierre-widget-011`,
rama `011-cierre-widget`, desde `94288cc`. El checkout principal y sus cambios
preexistentes no se actualizaron ni se copiaron como cambios de producto.

En ese worktree se ejecutó `specify extension add git`: exit 0, instalación del
paquete oficial **bundled 1.0.0** de Spec Kit 0.11.9, sin descarga. El catálogo
anuncia 1.0.1, pero esa versión no se instaló ni se atribuye al entorno probado.
`specify extension list` confirma `agent-context` 1.0.0 y `git` 1.0.0 habilitadas.

- Hook obligatorio `before_specify` registrado para `speckit.git.feature`.
- Cinco prompts Git generados; los prompts `speckit.*.md` quedan permitidos en Git.
- Settings, agentes y otros prompts Pi continúan ignorados; también `feature.json`.
- Auto-commit permanece desactivado en todos los eventos. La instalación no
  autoriza stage, commits, push, merge ni recreación de features históricas.
- Para 011 y 003 se selecciona su directorio existente: no se invoca el hook de
  nueva feature ni se regenera su spec por cambiar de rama.

Una segunda autocomprobación Node en sandbox obtuvo **8/8**, exit 0: prompts y
sintaxis; reglas de ignore; dry-run 012; creación de rama mediante script Git y
spec mediante core con el mismo ID; rechazo de rama duplicada sin cambiar HEAD;
selección explícita en linked worktree; auto-commit sin stage/commit; registro,
hook y HEAD/rama reales conservados. `git diff --check` volvió a pasar.

## Límites

No se ejecutó fetch ni se consultó GitHub: `origin/main` es la ref ya disponible,
no una comprobación de la punta remota actual. La segunda etapa instaló la extensión
solo en el worktree autorizado; no actualizó el checkout principal. No se staged
archivos, hicieron commits del proyecto, modificaron settings Pi ni migraron bases.
Las suites históricas de producto no se reejecutaron en esta verificación inicial de
Spec Kit. La [revalidación posterior de 011](../specs/RECONCILIATION.md) registra sus
gates de producto por separado, sin sustituir revisión independiente ni aceptación TUI.
